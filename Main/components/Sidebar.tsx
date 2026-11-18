import React from "react";
import {
    Library,
    ShoppingBag,
    NotebookPen,
    LogOut,
    User,
} from "lucide-react";
import { Session } from "@supabase/supabase-js";

interface SidebarProps {
    isSidebarOpen: boolean;
    activePage: string;
    navigateTo: (page: string) => void;
    fullName: string | null;
    session: Session | null;
    handleLogout: () => Promise<any>;
}

export default function Sidebar({
    isSidebarOpen,
    activePage,
    navigateTo,
    fullName,
    session,
    handleLogout,
}: SidebarProps) {
    const menuGroups = [
        {
            title: "STUDENT",
            items: [
                { label: "My Collection", icon: Library, tooltip: "My Collection" },
                { label: "My Notes", icon: NotebookPen, tooltip: "My Notes" },
                { label: "Buy Book", icon: ShoppingBag, tooltip: "Browse & Buy Books" }
            ]
        }
    ];

    const userName = fullName || session?.user?.user_metadata?.full_name || "Student";

    return (
        <aside
            style={{
                width: isSidebarOpen ? "200px" : "60px",
                height: "100%",
                borderRight: "1px solid #ddd",
                transition: "width 0.3s ease",
                display: "flex",
                flexDirection: "column",
                backgroundColor: "#f9f9f9",
                overflowX: "hidden",
            }}
        >
            <nav style={{ flex: 1, paddingTop: "20px" }}>
                {menuGroups.map((group, index) => (
                    <React.Fragment key={index}>
                        {index > 0 && <div className="menu-divider" />}
                        {group.items.map((item, i) => (
                            <div
                                key={i}
                                className={`menu-item ${activePage === item.label ? 'active' : ''}`}
                                title={!isSidebarOpen ? item.tooltip : ""}
                                onClick={() => navigateTo(item.label)}
                                role="button"
                                tabIndex={0}
                                style={{ justifyContent: isSidebarOpen ? "flex-start" : "center" }}
                            >
                                <span style={{ marginRight: isSidebarOpen ? "12px" : "0", display: "flex", alignItems: "center", color: "inherit" }}>
                                    <item.icon size={20} strokeWidth={2} />
                                </span>
                                {isSidebarOpen && (
                                    <span style={{ whiteSpace: "nowrap" }}>{item.label}</span>
                                )}
                            </div>
                        ))}
                    </React.Fragment>
                ))}
            </nav>

            {/* User Section at Bottom */}
            <div style={{
                borderTop: "1px solid #ddd",
                padding: isSidebarOpen ? "12px" : "8px 0",
                display: "flex",
                flexDirection: "column",
                alignItems: isSidebarOpen ? "stretch" : "center",
                gap: "4px",
            }}>
                <div
                    onClick={() => navigateTo("Profile")}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: isSidebarOpen ? "4px 8px" : "4px 0",
                        color: "#444",
                        cursor: "pointer",
                        borderRadius: "6px",
                    }}
                    className="menu-item"
                >
                    <User size={20} style={{ flexShrink: 0 }} />
                    {isSidebarOpen && (
                        <div style={{ overflow: "hidden" }}>
                            <div style={{ fontSize: "0.7rem", color: "#888", lineHeight: "1.2" }}>Logged in as</div>
                            <div style={{ fontWeight: 700, fontSize: "0.85rem", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userName}</div>
                        </div>
                    )}
                </div>
                <div
                    className="menu-item"
                    onClick={handleLogout}
                    aria-label="Sign out"
                    style={{
                        justifyContent: isSidebarOpen ? "flex-start" : "center",
                        color: "#d32f2f",
                        padding: "8px",
                    }}
                    title={!isSidebarOpen ? "Log Out" : ""}
                >
                    <span style={{ marginRight: isSidebarOpen ? "12px" : "0", display: "flex", alignItems: "center", color: "inherit" }}>
                        <LogOut size={18} />
                    </span>
                    {isSidebarOpen && <span>Sign Out</span>}
                </div>
            </div>
        </aside>
    );
}
