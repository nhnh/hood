import {
    Library,
    ShoppingBag,
    User,
    NotebookPen,
    Search,
    Printer,
    Plus,
    WifiOff,
} from "lucide-react";

const pageIcons: Record<string, React.ElementType> = {
    "My Collection": Library,
    "My Notes": NotebookPen,
    "Buy Book": ShoppingBag,
    "Profile": User,
};

interface TopPanelProps {
    activePage: string;
    isSidebarOpen: boolean;
    toggleSidebar: () => void;
    isOffline?: boolean;
    bookSearch?: string;
    setBookSearch?: (v: string) => void;
    collectionCount?: number;
    buyBookCount?: number;
    noteSearch?: string;
    setNoteSearch?: (v: string) => void;
    onAddNote?: () => void;
    activeTab?: string;
    setActiveTab?: (tab: "all" | "book" | "side") => void;
    tabCounts?: { all: number; book: number; side: number };
    noteViewTitle?: string | null;
    noteViewExport?: (() => void) | null;
    noteViewAddSection?: (() => void) | null;
    noteSearchPlaceholder?: string;
}

const TAB_LABELS: Record<string, string> = {
    all: "All Notes",
    book: "Book Notes",
    side: "Extra Notes",
};

export default function TopPanel({ activePage, isSidebarOpen, toggleSidebar, isOffline, bookSearch, setBookSearch, collectionCount, buyBookCount, noteSearch, setNoteSearch, onAddNote, activeTab, setActiveTab, tabCounts, noteViewTitle, noteViewExport, noteViewAddSection, noteSearchPlaceholder }: TopPanelProps) {
    const PageIcon = pageIcons[activePage] || Library;

    let leftContent: React.ReactNode;
    if (activePage === "My Notes" && noteViewTitle) {
        leftContent = (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span className="page-header-icon" style={{ marginRight: "6px" }}>
                    <NotebookPen size={24} />
                </span>
                <span style={{ fontWeight: 700, fontSize: "1.1rem", color: "#1e293b" }}>
                    {noteViewTitle}
                </span>
            </div>
        );
    } else if (activePage === "My Notes" && setActiveTab && tabCounts) {
        leftContent = (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="page-header-icon" style={{ marginRight: "6px" }}>
                    <PageIcon size={24} />
                </span>
                {(["all", "book", "side"] as const).map(tab => (
                    <div key={tab} style={{ display: "flex", alignItems: "center" }}>
                        <button
                            onClick={() => setActiveTab(tab)}
                            style={{
                                padding: "6px 14px",
                                height: "36px",
                                boxSizing: "border-box",
                                border: "none",
                                background: activeTab === tab ? "#396cd8" : "transparent",
                                color: activeTab === tab ? "#fff" : "#64748b",
                                fontWeight: 600,
                                fontSize: "0.85rem",
                                borderRadius: "6px",
                                cursor: "pointer",
                                transition: "all 0.15s",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                            }}
                        >
                            {TAB_LABELS[tab]}
                            <span style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                minWidth: "18px",
                                height: "18px",
                                borderRadius: "9px",
                                padding: "0 5px",
                                fontSize: "0.65rem",
                                fontWeight: 700,
                                backgroundColor: activeTab === tab ? "rgba(255,255,255,0.25)" : "#396cd8",
                                color: "#fff",
                                lineHeight: 1,
                            }}>{tabCounts[tab]}</span>
                        </button>
                        {tab === "side" && (
                            <button
                                onClick={() => { setActiveTab("side"); onAddNote?.(); }}
                                title="Add side note"
                                aria-label="Add section"
                                style={{
                                    padding: "6px 8px",
                                    height: "36px",
                                    boxSizing: "border-box",
                                    marginLeft: "4px",
                                    border: "none",
                                    background: "transparent",
                                    color: "#396cd8",
                                    fontWeight: 700,
                                    fontSize: "1.1rem",
                                    cursor: "pointer",
                                    borderRadius: "6px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    lineHeight: 1,
                                }}
                            >
                                +
                            </button>
                        )}
                    </div>
                ))}
            </div>
        );
    } else {
        leftContent = (
            <div className="page-header" style={{ margin: 0, display: "flex", alignItems: "center", gap: "10px" }}>
                <span className="page-header-icon">
                    <PageIcon size={24} />
                </span>
                <h1 style={{ fontSize: "1.2rem", margin: 0 }}>
                    {activePage === "Buy Book" && buyBookCount !== undefined
                        ? `Available Books (${buyBookCount})`
                        : activePage === "My Collection" && collectionCount !== undefined
                        ? `My Collection (${collectionCount} Books)`
                        : activePage}
                </h1>
                {isOffline && (
                    <span style={{
                        fontSize: "0.75rem",
                        backgroundColor: "#ffebee",
                        color: "#c62828",
                        padding: "3px 10px",
                        borderRadius: "12px",
                        fontWeight: "bold",
                        border: "1px solid #ffcdd2",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        animation: "pulse 2s ease-in-out infinite",
                    }}>
                        <WifiOff size={12} /> Offline Mode
                    </span>
                )}
            </div>
        );
    }

    return (
        <header
            style={{
                height: "60px",
                borderBottom: "1px solid #ddd",
                display: "flex",
                alignItems: "center",
                backgroundColor: "#fff",
                flexShrink: 0,
            }}
        >
            {/* Branding Section: same width as sidebar */}
            <div
                onClick={toggleSidebar}
                style={{
                    width: isSidebarOpen ? "160px" : "60px",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: isSidebarOpen ? "flex-start" : "center",
                    padding: isSidebarOpen ? "0 20px" : "0",
                    borderRight: "1px solid #ddd",
                    cursor: "pointer",
                    transition: "width 0.3s ease",
                    overflow: "hidden",
                    flexShrink: 0,
                }}
            >
                <img src="logo.png" alt="Logo" style={{ height: "40px", width: "auto", flexShrink: 0 }}
                     onError={(e) => { (e.target as HTMLElement).style.display = "none"; }} />
                {isSidebarOpen && (
                    <span style={{
                        marginLeft: "12px",
                        fontWeight: "800",
                        fontSize: "1.2rem",
                        color: "#396cd8",
                        whiteSpace: "nowrap"
                    }}>
                        CloudShelf
                    </span>
                )}
            </div>

            {/* Header Content */}
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", gap: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: "1 1 auto", minWidth: 0 }}>
                    {leftContent}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                    {(activePage === "My Collection" || activePage === "Buy Book") && setBookSearch && (
                        <div style={{ position: "relative", maxWidth: "260px", width: "100%", minWidth: "140px" }}>
                            <Search size={15} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#888" }} />
                            <input
                                type="text"
                                className="form-control"
                                placeholder="Search books..."
                                style={{ paddingLeft: "32px", height: "32px", fontSize: "0.8rem" }}
                                value={bookSearch}
                                onChange={(e) => setBookSearch(e.target.value)}
                            />
                        </div>
                    )}
                    {activePage === "My Notes" && setNoteSearch && (
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            {noteViewAddSection && (
                                <button className="btn btn-secondary" onClick={noteViewAddSection} aria-label="Add section" style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '6px', height: '36px', padding: '0 14px', fontSize: '0.85rem' }}>
                                    <Plus size={16} /> Add Section
                                </button>
                            )}
                            {noteViewExport && (
                                <button className="btn btn-primary" onClick={noteViewExport} aria-label="Export notes" style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '6px', height: '36px', padding: '0 14px', fontSize: '0.85rem' }}>
                                    <Printer size={16} /> Export
                                </button>
                            )}
                            <div style={{ position: "relative", maxWidth: "260px", width: "100%", minWidth: "140px" }}>
                                <Search size={15} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#888" }} />
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder={noteSearchPlaceholder || "Search notes..."}
                                    style={{ paddingLeft: "32px", height: "32px", fontSize: "0.8rem" }}
                                    value={noteSearch}
                                    onChange={(e) => setNoteSearch(e.target.value)}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}
