import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { User, Mail, Monitor, KeyRound, WifiOff, Info, UserRoundX, RefreshCw, CheckCircle2, Download, Upload, Trash2, AlertTriangle, X } from "lucide-react";
import { Session } from "@supabase/supabase-js";
import { showToast } from "../lib/toast";
import { cacheUserCredentials, clearOfflineSession, purgeUserOfflineData } from "../lib/offlineAuth";
import { getAppVersion, STORAGE } from "../lib/appConfig";
import { check } from "@tauri-apps/plugin-updater";
import { message } from "@tauri-apps/plugin-dialog";
import { fetchLatestRelease, downloadAppFile } from "../lib/appUpdater";
import { getLeftThumb } from "../lib/deviceFingerprint";
import { exportNotesToFile, importNotesFromFile } from "../lib/offlineBackup";

interface ProfileProps {
    session: Session | null;
    fullName: string | null;
}

export default function Profile({ session, fullName }: ProfileProps) {
    const [fingerprint, setFingerprint] = useState("Loading...");
    const [isOffline, setIsOffline] = useState(!navigator.onLine);

    const [appVersion, setAppVersion] = useState("");

    useEffect(() => {
        getAppVersion().then(setAppVersion);
    }, []);

    useEffect(() => {
        getLeftThumb().then(fp => setFingerprint(fp)).catch(() => setFingerprint("No Device Registered"));
    }, []);

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

    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [pwMessage, setPwMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const [checkingUpdate, setCheckingUpdate] = useState(false);
    const [installingUpdate, setInstallingUpdate] = useState(false);
    const [availableUpdate, setAvailableUpdate] = useState<{ version: string; install: () => Promise<void> } | null>(null);
    const [updateStatus, setUpdateStatus] = useState<{ kind: "up-to-date" | "available" | "error"; text: string; version?: string } | null>(null);
    const [backingUp, setBackingUp] = useState(false);
    const [importing, setImporting] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deletePassword, setDeletePassword] = useState("");
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);
    const [backupBeforeDelete, setBackupBeforeDelete] = useState(true);
    const [gdriveFallback, setGdriveFallback] = useState(false);

    const handleUpdatePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newPassword || !confirmPassword) return;

        if (newPassword !== confirmPassword) {
            setPwMessage({ type: 'error', text: "Passwords do not match!" });
            return;
        }

        setLoading(true);
        setPwMessage(null);

        try {
            const { error } = await supabase.auth.updateUser({
                password: newPassword
            });

            if (error) {
                setPwMessage({ type: 'error', text: error.message });
            } else {
                if (session) {
                    await cacheUserCredentials(
                        session,
                        fullName || "Student",
                        "buyer",
                        newPassword
                    );
                }
                setPwMessage({ type: 'success', text: "Password successfully updated!" });
                setNewPassword("");
                setConfirmPassword("");
            }
        } catch (err) {
            console.error("Password update failed:", err);
            showToast("Failed to update password. Please try again.", "error");
            setPwMessage({ type: 'error', text: "An unexpected error occurred." });
        }
        setLoading(false);
    };

    const handleCheckUpdate = async () => {
        if (isOffline || !navigator.onLine) {
            showToast("Cannot check for updates while offline.", "warning");
            setUpdateStatus({ kind: "error", text: "No internet connection. Please connect and try again." });
            return;
        }
        setCheckingUpdate(true);
        setUpdateStatus(null);
        setAvailableUpdate(null);
        try {
            const update = await check();
            localStorage.setItem(
                STORAGE.CHECK_UPDATES_CACHE_KEY,
                JSON.stringify({ version: appVersion, timestamp: Date.now() })
            );

            if (update) {
                setAvailableUpdate({
                    version: update.version,
                    install: async () => {
                        setInstallingUpdate(true);
                        try {
                            showToast(`Downloading update v${update.version}...`, "info");
                            await update.downloadAndInstall();
                            await message(
                                "Update has been downloaded. The application will now restart to apply the update.",
                                { title: "Update Ready", kind: "info" }
                            );
                            localStorage.removeItem(STORAGE.CHECK_UPDATES_CACHE_KEY);
                        } catch (installErr: unknown) {
                            console.error("Failed to download/install update:", installErr);
                            const msg = installErr instanceof Error ? installErr.message : "Unknown error";
                            showToast(`Update failed: ${msg}`, "error");
                            setInstallingUpdate(false);
                        }
                    },
                });
                setUpdateStatus({
                    kind: "available",
                    text: `Version ${update.version} is available. Click "Install Update" to download and restart.`,
                    version: update.version,
                });
            } else {
                setUpdateStatus({ kind: "up-to-date", text: `You are running the latest version (v${appVersion}).` });
            }
        } catch (err: unknown) {
            console.error("Update check failed:", err);
            const msg = err instanceof Error ? err.message : "Unknown error";
            setUpdateStatus({ kind: "error", text: `Could not check for updates: ${msg}` });
            showToast("Failed to check for updates.", "error");
        }
        setCheckingUpdate(false);
    };

    const handleBackup = async () => {
        if (!session?.user?.id) {
            showToast("You must be logged in to back up notes.", "error");
            return;
        }
        setBackingUp(true);
        try {
            await exportNotesToFile(session.user.id);
            showToast("Notes backup completed.", "success");
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            showToast(`Backup failed: ${msg}`, "error");
        }
        setBackingUp(false);
    };

    const handleImport = async () => {
        if (!session?.user?.id) {
            showToast("You must be logged in to import notes.", "error");
            return;
        }
        setImporting(true);
        try {
            const result = await importNotesFromFile(session.user.id);
            if (result.message !== "Cancelled") {
                showToast(result.message, result.success ? "success" : "error");
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            showToast(`Import failed: ${msg}`, "error");
        }
        setImporting(false);
    };

    const handleDeleteAccount = async () => {
        if (!session?.user?.id || !session?.user?.email) return;
        setDeleteLoading(true);
        setDeleteError(null);

        try {
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: session.user.email,
                password: deletePassword,
            });

            if (signInError) {
                setDeleteError("Incorrect password. Please try again.");
                setDeleteLoading(false);
                return;
            }

            setShowDeleteModal(false);
            setShowConfirmDelete(true);
            setDeletePassword("");
        } catch {
            setDeleteError("An unexpected error occurred.");
        }
        setDeleteLoading(false);
    };

    const handleConfirmDelete = async () => {
        if (!session?.user?.id) return;
        setDeleteLoading(true);

        try {
            const uid = session.user.id;

            if (backupBeforeDelete) {
                try {
                    await exportNotesToFile(uid);
                } catch (err) {
                    console.warn("Backup before deletion failed:", err);
                }
            }

            await supabase.from("bookmarks").delete().eq("user_id", uid);
            await supabase.from("notes").delete().eq("user_id", uid);
            await supabase.from("book_access").delete().eq("user_id", uid);
            await supabase.from("devices").delete().eq("user_id", uid);
            await supabase.from("sections").delete().eq("created_by", uid);
            await supabase.from("semesters").delete().eq("created_by", uid);
            await supabase.from("book_files").delete().in("book_id", (await supabase.from("books").select("id").eq("created_by", uid)).data?.map(b => b.id) ?? []);
            await supabase.from("books").delete().eq("created_by", uid);
            await supabase.from("pins").delete().eq("seller_id", uid);
            await supabase.from("profiles").delete().eq("id", uid);

            purgeUserOfflineData(uid);
            clearOfflineSession();
            await supabase.auth.signOut();

            showToast("Your account has been permanently deleted.", "success");
        } catch (err) {
            console.error("Account deletion failed:", err);
            setDeleteError("Failed to delete account. Please try again.");
            setShowConfirmDelete(false);
            setShowDeleteModal(true);
            showToast("Account deletion failed. Please try again.", "error");
        }
        setDeleteLoading(false);
    };

    const closeDeleteModals = () => {
        setShowDeleteModal(false);
        setShowConfirmDelete(false);
        setDeletePassword("");
        setDeleteError(null);
        setBackupBeforeDelete(true);
    };

    return (
        <div style={{ display: 'flex', gap: '30px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div className="page-section" style={{ flex: '1 1 400px', minWidth: 0 }}>
                <div className="section-header">
                    <h3>
                        <User size={20} />
                        Student Information
                    </h3>
                </div>
                <div className="section-content">
                    <div>
                        <div className="form-group">
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <User size={14} color="#888" /> Full Name
                            </label>
                            <input
                                type="text"
                                className="form-control"
                                value={fullName ?? ""}
                                readOnly
                                style={{ backgroundColor: "#f0f2f5", cursor: "not-allowed" }}
                            />
                        </div>

                        <div className="form-group" style={{ marginTop: "15px" }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Mail size={14} color="#888" /> E-Mail
                            </label>
                            <input
                                type="text"
                                className="form-control"
                                value={session?.user?.email || ""}
                                readOnly
                                style={{ backgroundColor: "#f0f2f5", cursor: "not-allowed" }}
                            />
                        </div>

                        <div className="form-group" style={{ marginTop: "15px" }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Monitor size={14} color="#888" /> Device Signature
                            </label>
                            <div
                                className="form-control"
                                style={{ backgroundColor: "#e8f0fe", color: "#1967d2", fontFamily: "monospace", fontWeight: "bold", cursor: "not-allowed", fontSize: "0.75rem", wordBreak: "break-all", padding: "8px 12px", lineHeight: "1.4", minHeight: "38px" }}
                            >
                                {fingerprint}
                            </div>
                            <span style={{ fontSize: "0.75rem", color: "#888", marginTop: "5px" }}>
                                This device can store multiple accounts. Each account's offline data (notes, books) is isolated.
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="page-section" style={{ flex: '1 1 400px', minWidth: 0 }}>
                <div className="section-header">
                    <h3>
                        <KeyRound size={20} />
                        Security Update
                    </h3>
                </div>
                <div className="section-content">
                    {isOffline && (
                        <div className="login-warning" style={{ marginBottom: "15px" }}>
                            <WifiOff size={20} style={{ flexShrink: 0, marginTop: "2px" }} />
                            <div>
                                <strong>OFFLINE MODE:</strong> Password changes require an internet connection. Please connect to the internet to update your password.
                            </div>
                        </div>
                    )}

                    <form onSubmit={handleUpdatePassword} style={{ maxWidth: "500px" }}>
                        <div className="form-group">
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <KeyRound size={14} color="#888" /> New Password
                            </label>
                            <input
                                type="password"
                                className="form-control"
                                placeholder="Enter new password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                                disabled={isOffline}
                            />
                        </div>

                        <div className="form-group" style={{ marginTop: "15px" }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <KeyRound size={14} color="#888" /> Confirm Password
                            </label>
                            <input
                                type="password"
                                className="form-control"
                                placeholder="Re-type new password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                disabled={isOffline}
                            />
                        </div>

                        {pwMessage && (
                            <p style={{
                                marginTop: "10px",
                                fontSize: "0.85rem",
                                color: pwMessage.type === 'success' ? '#2e7d32' : '#d32f2f'
                            }}>
                                {pwMessage.text}
                            </p>
                        )}

                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={loading || isOffline || !newPassword || newPassword !== confirmPassword}
                            style={{ marginTop: "15px", backgroundColor: isOffline ? "#888" : "#396cd8", color: "#fff", border: "none", cursor: isOffline ? "not-allowed" : "pointer" }}
                        >
                            {loading ? "Updating..." : isOffline ? "Unavailable Offline" : "Update Password"}
                        </button>
                    </form>
                </div>
            </div>

            <div className="page-section" style={{ flex: '1 1 400px', minWidth: 0 }}>
                <div className="section-header">
                    <h3>
                        <Info size={20} />
                        App Version
                    </h3>
                </div>
                <div className="section-content">
                    {isOffline && (
                        <div className="login-warning" style={{ marginBottom: "15px" }}>
                            <WifiOff size={20} style={{ flexShrink: 0, marginTop: "2px" }} />
                            <div>
                                <strong>OFFLINE MODE:</strong> Checking for updates requires an internet connection. Please connect to the internet to check for updates.
                            </div>
                        </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        <div style={{
                            padding: '8px 14px',
                            backgroundColor: '#e8f0fe',
                            color: '#1967d2',
                            borderRadius: '6px',
                            fontWeight: 700,
                            fontSize: '0.95rem',
                            fontFamily: 'monospace',
                        }}>
                            v{appVersion || "..."}
                        </div>
                        <button
                            type="button"
                            onClick={handleCheckUpdate}
                            disabled={checkingUpdate || isOffline}
                            title={isOffline ? "Internet required to check for updates" : "Check for latest version"}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '8px 14px',
                                backgroundColor: isOffline ? '#888' : '#396cd8',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: isOffline ? 'not-allowed' : 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                opacity: checkingUpdate ? 0.7 : 1,
                            }}
                        >
                            <RefreshCw size={14} className={checkingUpdate ? "spinner-mini" : ""} />
                            {checkingUpdate ? "Checking..." : isOffline ? "Unavailable Offline" : "Check for Updates"}
                        </button>
                    {availableUpdate && (
                        <>
                            <button
                                type="button"
                                onClick={availableUpdate.install}
                                disabled={installingUpdate}
                                title={`Download and install v${availableUpdate.version}`}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '8px 14px',
                                    backgroundColor: installingUpdate ? '#888' : '#2e7d32',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: installingUpdate ? 'not-allowed' : 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: 600,
                                    opacity: installingUpdate ? 0.7 : 1,
                                }}
                            >
                                <Download size={14} className={installingUpdate ? "spinner-mini" : ""} />
                                {installingUpdate ? "Installing..." : `Install Update v${availableUpdate.version}`}
                            </button>
                            <button
                                type="button"
                                onClick={async () => {
                                    setGdriveFallback(true);
                                    try {
                                        const release = await fetchLatestRelease(
                                            navigator.userAgent.includes("Win") ? "windows-x86_64" : "linux-x86_64"
                                        );
                                        if (!release) { showToast("No release found for your platform.", "error"); setGdriveFallback(false); return; }
                                        const buffer = await downloadAppFile(release.installer_url, release.gdrive_url);
                                        const ext = release.installer_url.split('.').pop() || 'msi';
                                        const { writeFile } = await import("@tauri-apps/plugin-fs");
                                        const { join, downloadDir } = await import("@tauri-apps/api/path");
                                        const dir = await downloadDir();
                                        const filePath = await join(dir, `CloudShelf-Reader-${release.version}.${ext}`);
                                        await writeFile(filePath, new Uint8Array(buffer));
                                        const { openPath } = await import("@tauri-apps/plugin-opener");
                                        await openPath(filePath);
                                        showToast(`Saved to Downloads: CloudShelf-Reader-${release.version}.${ext}`, "success");
                                    } catch (err) {
                                        showToast(`Download failed: ${err instanceof Error ? err.message : "Unknown"}`, "error");
                                    }
                                    setGdriveFallback(false);
                                }}
                                disabled={gdriveFallback}
                                title="Download installer via direct link (alternative)."
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '8px 14px',
                                    backgroundColor: gdriveFallback ? '#888' : '#1565c0',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: gdriveFallback ? 'not-allowed' : 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: 600,
                                    opacity: gdriveFallback ? 0.7 : 1,
                                }}
                            >
                                <Download size={14} className={gdriveFallback ? "spinner-mini" : ""} />
                                {gdriveFallback ? "Downloading..." : "Alternative Download"}
                            </button>
                        </>
                    )}
                </div>

                {updateStatus && (
                    <div style={{
                        marginTop: '12px',
                        padding: '10px 12px',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        backgroundColor: updateStatus.kind === 'up-to-date' ? '#e8f5e9'
                            : updateStatus.kind === 'available' ? '#fff3e0'
                            : '#ffebee',
                        color: updateStatus.kind === 'up-to-date' ? '#2e7d32'
                            : updateStatus.kind === 'available' ? '#e65100'
                            : '#c62828',
                    }}>
                        {updateStatus.kind === 'up-to-date' && <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: '1px' }} />}
                        {updateStatus.kind === 'available' && <RefreshCw size={16} style={{ flexShrink: 0, marginTop: '1px' }} />}
                        {updateStatus.kind === 'error' && <WifiOff size={16} style={{ flexShrink: 0, marginTop: '1px' }} />}
                        <span>{updateStatus.text}</span>
                    </div>
                )}

                    <span style={{ fontSize: '0.75rem', color: '#888', marginTop: '10px', display: 'block' }}>
                        CloudShelf Reader automatically checks for updates every 24 hours. You can also check manually here.
                    </span>
                </div>
            </div>

            <div className="page-section" style={{ flex: '1 1 400px', minWidth: 0 }}>
                <div className="section-header">
                    <h3>
                        <Download size={20} />
                        Data Backup
                    </h3>
                </div>
                <div className="section-content">
                    <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '15px', lineHeight: 1.5 }}>
                        Back up your notes to a single encrypted file. Your purchased books can be re-downloaded
                        from the server after reinstalling the app.
                    </p>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            onClick={handleBackup}
                            disabled={backingUp || !session?.user?.id}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '8px 14px',
                                backgroundColor: '#396cd8',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: !session?.user?.id ? 'not-allowed' : 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                opacity: backingUp ? 0.7 : 1,
                            }}
                        >
                            <Download size={14} className={backingUp ? "spinner-mini" : ""} />
                            {backingUp ? "Exporting..." : "Backup Data"}
                        </button>
                        <button
                            type="button"
                            onClick={handleImport}
                            disabled={importing || !session?.user?.id}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '8px 14px',
                                backgroundColor: '#2e7d32',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: !session?.user?.id ? 'not-allowed' : 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                opacity: importing ? 0.7 : 1,
                            }}
                        >
                            <Upload size={14} className={importing ? "spinner-mini" : ""} />
                            {importing ? "Importing..." : "Import Data"}
                        </button>
                    </div>
                </div>
            </div>

            <div className="page-section" style={{ width: '100%', borderColor: '#ffcdd2' }}>
                <div className="section-header" style={{ backgroundColor: '#fff5f5' }}>
                    <h3 style={{ color: '#d32f2f' }}>
                        <UserRoundX size={20} />
                        Delete Account
                    </h3>
                </div>
                <div className="section-content">
                    <div style={{ borderTop: '1px solid #ffcdd2', paddingTop: '12px' }}>
                        <button
                            type="button"
                            onClick={() => {
                                if (isOffline) {
                                    showToast("You must be online to delete your account.", "error");
                                    return;
                                }
                                setShowDeleteModal(true);
                                setDeleteError(null);
                                setDeletePassword("");
                            }}
                            className="btn"
                            style={{
                                width: '100%',
                                backgroundColor: '#b71c1c',
                                color: '#fff',
                                border: '1px solid #d32f2f',
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                padding: '10px',
                                minHeight: '40px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                opacity: isOffline ? 0.5 : 1,
                                cursor: isOffline ? 'not-allowed' : 'pointer',
                            }}
                        >
                            <Trash2 size={16} /> Permanently Delete Account
                        </button>
                    </div>
                </div>
            </div>

            {showDeleteModal && (
                <div className="modal-overlay" style={{ zIndex: 7000 }} onClick={closeDeleteModals}>
                    <div className="modal-content" style={{ width: "400px", textAlign: "center", padding: "40px 30px" }} onClick={(e) => e.stopPropagation()}>
                        <button className="close-btn" onClick={closeDeleteModals} style={{ position: "absolute", top: "12px", right: "12px" }}>
                            <X size={20} />
                        </button>
                        <img
                            src="logo.png"
                            alt="CloudShelf Logo"
                            className="login-logo"
                            style={{ margin: "0 auto 16px" }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        <h2 className="login-title" style={{ fontSize: "1.3rem", marginBottom: "12px" }}>Delete Account</h2>
                        <p style={{ color: "#b71c1c", fontSize: "0.95rem", fontWeight: 700, lineHeight: 1.5, margin: "0 0 8px" }}>
                            <AlertTriangle size={20} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
                            Your account will be permanently deleted.
                        </p>
                        <p style={{ color: "#c62828", fontSize: "0.85rem", fontWeight: 600, margin: "0 0 20px" }}>
                            This action cannot be undone!
                        </p>
                        <p style={{ color: "#666", fontSize: "0.85rem", margin: "0 0 16px" }}>
                            Please enter your password to continue
                        </p>
                        <div style={{ textAlign: "left" }}>
                            <input
                                type="password"
                                className="form-control"
                                placeholder="Enter your password"
                                value={deletePassword}
                                onChange={(e) => setDeletePassword(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter" && !deleteLoading && deletePassword) handleDeleteAccount(); }}
                                style={{ fontSize: "1.1rem", padding: "12px", marginBottom: deleteError ? "8px" : "16px" }}
                                autoFocus
                            />
                            {deleteError && (
                                <p className="login-error" style={{ marginBottom: "12px" }}>{deleteError}</p>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={handleDeleteAccount}
                            disabled={deleteLoading || !deletePassword}
                            className="btn"
                            style={{
                                width: '100%',
                                backgroundColor: '#d32f2f',
                                color: '#fff',
                                border: 'none',
                                fontSize: '1rem',
                                fontWeight: 700,
                                padding: '12px',
                                minHeight: '48px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                opacity: (!deletePassword || deleteLoading) ? 0.6 : 1,
                                cursor: (!deletePassword || deleteLoading) ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {deleteLoading ? "Verifying..." : "Delete My Account"}
                        </button>
                    </div>
                </div>
            )}

            {showConfirmDelete && (
                <div className="modal-overlay" style={{ zIndex: 7000 }} onClick={closeDeleteModals}>
                    <div className="modal-content" style={{ width: "400px", textAlign: "center", padding: "40px 30px" }} onClick={(e) => e.stopPropagation()}>
                        <button className="close-btn" onClick={closeDeleteModals} style={{ position: "absolute", top: "12px", right: "12px" }}>
                            <X size={20} />
                        </button>
                        <div style={{ color: "#b71c1c", marginBottom: "16px" }}>
                            <AlertTriangle size={48} strokeWidth={1.5} />
                        </div>
                        <h2 style={{ color: "#b71c1c", fontSize: "1.3rem", margin: "0 0 12px" }}>Are you absolutely sure?</h2>
                        <p style={{ color: "#666", fontSize: "0.9rem", lineHeight: 1.5, margin: "0 0 8px" }}>
                            This will permanently delete your account and all associated data including your notes, bookmarks, and access to purchased books.
                        </p>
                        <p style={{ color: "#c62828", fontSize: "0.85rem", fontWeight: 700, margin: "0 0 24px" }}>
                            This action cannot be undone!
                        </p>
                        <label style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "center", marginBottom: "20px", cursor: "pointer", fontSize: "0.85rem", color: "#555" }}>
                            <input
                                type="checkbox"
                                checked={backupBeforeDelete}
                                onChange={(e) => setBackupBeforeDelete(e.target.checked)}
                                style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "#396cd8" }}
                            />
                            Backup My Data
                        </label>
                        <div style={{ display: "flex", gap: "12px" }}>
                            <button
                                type="button"
                                onClick={closeDeleteModals}
                                className="btn btn-secondary"
                                style={{ flex: 1, fontSize: "0.95rem", padding: "12px" }}
                                disabled={deleteLoading}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmDelete}
                                disabled={deleteLoading}
                                className="btn"
                                style={{
                                    flex: 1,
                                    backgroundColor: '#b71c1c',
                                    color: '#fff',
                                    border: 'none',
                                    fontSize: '0.95rem',
                                    fontWeight: 700,
                                    padding: '12px',
                                    opacity: deleteLoading ? 0.6 : 1,
                                    cursor: deleteLoading ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {deleteLoading ? "Deleting..." : "Yes, Delete"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
