import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { ShieldAlert, Monitor, WifiOff } from "lucide-react";
import {
    verifyOfflineCredentials,
    cacheUserCredentials,
    hasOfflineCredentials,
    cacheDeviceVerification,
} from "../lib/offlineAuth";
import { showToast } from "../lib/toast";
import { getLeftThumb, getPlatform } from "../lib/deviceFingerprint";
import type { Session } from "@supabase/supabase-js";

interface LoginRegisterProps {
    onSessionChange?: (session: Session) => void;
}

export default function LoginRegister({ onSessionChange }: LoginRegisterProps) {
    const [isRegisterMode, setIsRegisterMode] = useState(false);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [fullName, setFullName] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [hasOfflineCreds, setHasOfflineCreds] = useState(hasOfflineCredentials());

    useEffect(() => {
        const handleOnline = () => setIsOffline(false);
        const handleOffline = () => setIsOffline(true);

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
        };
    }, []);

    useEffect(() => {
        setHasOfflineCreds(hasOfflineCredentials());
    }, [isOffline]);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        if (isRegisterMode) {
            if (isOffline) {
                setError("Registration requires an active internet connection.");
                setLoading(false);
                return;
            }
            // Register Flow
            const { data, error: signUpError } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: fullName,
                        role: "buyer",
                    },
                    emailRedirectTo: window.location.origin,
                }
            });

            if (signUpError) {
                setError(signUpError.message);
                setLoading(false);
                return;
            }

            if (data?.user) {
                // Explicitly save the full name to the public.profiles table.
                // If email confirmation is required, this may fail due to RLS,
                // but the profile will be created/updated during the first login.
                try {
                    const { error: profileError } = await supabase
                        .from("profiles")
                        .insert({
                            id: data.user.id,
                            email: email,
                            full_name: fullName,
                            role: "buyer",
                        });

                    if (profileError) {
                        console.log("Profile record will be finalized upon first login.");
                    }
                } catch (err) {
                    console.error("Profile insert failed:", err);
                    showToast("Failed to create profile. Please contact support.", "error");
                }

                showToast("Registration Successful! Your account has been created. Please log in with your email and password to bind this device.", "success");
                setIsRegisterMode(false);
            }
        } else {
            // Login Flow
            if (isOffline) {
                try {
                    const mockSession = await verifyOfflineCredentials(email, password);
                    if (onSessionChange) {
                        onSessionChange(mockSession);
                    }
                } catch (offlineErr: unknown) {
                    setError(offlineErr instanceof Error ? offlineErr.message : "Login failed");
                } finally {
                    setLoading(false);
                }
                return;
            }

            const { data, error: signInError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (signInError) {
                if (signInError.message.toLowerCase().includes("invalid login credentials")) {
                    setError("FAILED: Invalid email or password.");
                } else {
                    setError(signInError.message);
                }
                setLoading(false);
                return;
            }

            if (data?.user) {
                // Ensure profile row exists in authenticated context
                let profileCheck;
                try {
                    const result = await supabase
                        .from("profiles")
                        .select("roles, is_banned, full_name")
                        .eq("id", data.user.id)
                        .maybeSingle();
                    profileCheck = result.data;
                } catch (err) {
                    console.error("Profile select failed:", err);
                }

                let profile = profileCheck;

                if (!profile) {
                    // Try to upsert profile if missing under the authenticated user session
                    try {
                        const { data: insertedProfile, error: profileError } = await supabase
                            .from("profiles")
                            .upsert({
                                id: data.user.id,
                                email: data.user.email,
                                roles: ["buyer"],
                                full_name: data.user.user_metadata?.full_name || fullName || "Student"
                            })
                            .select()
                            .single();

                        if (profileError) {
                            console.error("Profile Upsert Error at Login:", profileError.message);
                        } else {
                            profile = insertedProfile;
                        }
                    } catch (err) {
                        console.error("Profile upsert failed:", err);
                    }
                }

                if (profile?.is_banned) {
                    await supabase.auth.signOut();
                    setError("ACCESS DENIED: Your account has been suspended (banned).");
                    setLoading(false);
                    return;
                }

                // If profile role is moderator/seller, check if they bypass (student panel only for buyer)
                if (profile && !profile.roles?.includes("buyer")) {
                    await supabase.auth.signOut();
                    setError("RESTRICTED ACCESS: This panel is for Student (Buyer) accounts only.");
                    setLoading(false);
                    return;
                }

                // Check device binding via RPC (left_thumb)
                let thumb: string;
                let plat: string;
                try {
                    [thumb, plat] = await Promise.all([getLeftThumb(), getPlatform()]);
                } catch {
                    await supabase.auth.signOut();
                    setError("FAILED: Device verification unavailable. Please use the desktop app.");
                    setLoading(false);
                    return;
                }

                let bindResult: string;
                try {
                    const { data: rpcData, error: rpcError } = await supabase
                        .rpc("check_device_binding", {
                            p_user_id: data.user.id,
                            p_left_thumb: thumb,
                            p_platform: plat,
                        });

                    if (rpcError) {
                        console.error("Device RPC error:", rpcError.message);
                        await supabase.auth.signOut();
                        setError("DEVICE ERROR: Failed to verify your device. Please try again.");
                        setLoading(false);
                        return;
                    }
                    bindResult = rpcData as string;
                } catch (err) {
                    console.error("Device RPC call failed:", err);
                    await supabase.auth.signOut();
                    setError("DEVICE ERROR: Failed to verify your device. Please try again.");
                    setLoading(false);
                    return;
                }

                if (bindResult === 'blocked') {
                    await supabase.auth.signOut();
                    setError(
                        "MULTIPLE DEVICE LOGIN DETECTED\n\n" +
                        "We've locked your devices temporarily. " +
                        "Please contact your moderator to update your device."
                    );
                    setLoading(false);
                    return;
                }

                // Device verified OK — cache for offline
                cacheDeviceVerification(thumb);

                // Successfully logged in and verified online. Cache details including password hash!
                if (data.session) {
                    await cacheUserCredentials(
                        data.session,
                        profile?.full_name || "Student",
                        profile?.roles?.[0] || "buyer",
                        password
                    );
                }

                if (onSessionChange && data.session) {
                    onSessionChange(data.session);
                }
            }
        }
        setLoading(false);
    };

    return (
        <div className="login-wrapper">
            <div className="login-card">
                <img
                    src="logo.png"
                    alt="CloudShelf Logo"
                    className="login-logo"
                    onError={(e) => { console.error("Logo failed to load at path:", (e.target as HTMLImageElement).src); }}
                />

                <h2 className="login-title">CloudShelf | Reader</h2>

                {isOffline && (
                    <div className="login-warning">
                        <WifiOff size={24} style={{ flexShrink: 0, marginTop: "2px" }} />
                        <div>
                            <strong>OFFLINE MODE:</strong> No internet connection. You can log in with your cached credentials to read offline.
                            {!hasOfflineCreds && (
                                <div style={{ marginTop: "5px", color: "#b71c1c", fontWeight: "bold" }}>
                                    Warning: No offline credentials cached on this device. You must log in online at least once first.
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <form onSubmit={handleAuth} className="login-form">
                    {isRegisterMode && (
                        <>
                            <label htmlFor="register-name" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden" }}>Full Name</label>
                            <input
                                id="register-name"
                                type="text"
                                placeholder="Full Name (as per IC/ID)"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                required
                                className="form-control"
                            />
                        </>
                    )}
                    <label htmlFor="auth-email" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden" }}>Email</label>
                    <input
                        id="auth-email"
                        type="email"
                        placeholder="Email Address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="form-control"
                    />
                    <label htmlFor="auth-password" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden" }}>Password</label>
                    <input
                        id="auth-password"
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="form-control"
                    />

                    {error && <p className="login-error">{error}</p>}

                    <button
                        type="submit"
                        disabled={loading || (isOffline && !hasOfflineCreds && !isRegisterMode)}
                        className="btn-primary"
                        style={{
                            marginTop: "10px",
                            backgroundColor: (isOffline && !hasOfflineCreds && !isRegisterMode) ? "#888" : undefined,
                            cursor: (isOffline && !hasOfflineCreds && !isRegisterMode) ? "not-allowed" : undefined
                        }}
                    >
                        {loading ? "Please wait..." : isRegisterMode ? "Register Account & Bind Device" : isOffline ? "Login Offline" : "Login"}
                    </button>
                </form>

                <div className="login-toggle">
                    {isOffline ? (
                        <p style={{ color: "#777", fontStyle: "italic" }}>
                            Registration is disabled offline. Connect to internet to register.
                        </p>
                    ) : isRegisterMode ? (
                        <p>
                            Already have an account?{" "}
                            <span
                                onClick={() => { setIsRegisterMode(false); setError(null); }}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === 'Enter') { setIsRegisterMode(false); setError(null); } }}
                            >
                                Login here
                            </span>
                        </p>
                    ) : (
                        <p>
                            Not registered yet?{" "}
                            <span
                                onClick={() => { setIsRegisterMode(true); setError(null); }}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === 'Enter') { setIsRegisterMode(true); setError(null); } }}
                            >
                                Register a new account
                            </span>
                        </p>
                    )}
                </div>

                <div className="login-device-warning">
                    <ShieldAlert size={28} style={{ flexShrink: 0, marginTop: "2px" }} />
                    <div>
                        <strong>DEVICE WARNING:</strong> Your account will be permanently tied to this device.<br />
                        <Monitor size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 3 }} />
                        Only 1 device is allowed per account.
                    </div>
                </div>
            </div>
        </div>
    );
}
