import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight, EyeOff, ShieldAlert, FileText, MessageSquare, Save, BookCopy, Square, X, Search, LayoutGrid, Printer, Plus, Pencil, Trash2, List } from "lucide-react";
import { getBookPdf } from "../lib/offlineBooks";
import { openPdfDocument } from "../lib/pdfLoader";
import { loadNotes, saveNotes } from "../lib/offlineNotes";
import SimpleRichEditor from "../components/SimpleRichEditor";
import ReaderPageCanvas from "../components/ReaderPageCanvas";
import type { Book, PDFDocument, TOCEntry } from "../types";
import { startDevToolsDetection } from "../lib/devToolsDetector";
import { startContentIntegrityCheck } from "../lib/contentIntegrity";
import { startOverlayDetection } from "../lib/overlayDetector";
import { verifyOfflineCredentials, getCachedUser, cacheDeviceVerification, clearDeviceVerificationCache } from "../lib/offlineAuth";
import { getLeftThumb } from "../lib/deviceFingerprint";
import { supabase } from "../supabaseClient";
import { showToast } from "../lib/toast";

function stripHtmlText(html: string): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

interface BookNote {
    id: string;
    page: number;
    text: string;
    createdAt: number;
    title?: string;
}

interface BookReaderProps {
    book: Book;
    onClose: () => void;
    studentName?: string | null;
    studentEmail?: string | null;
    initialPage?: number;
    userId?: string;
}

function generateNoteId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function BookReader({ book, onClose, studentName, studentEmail, initialPage, userId }: BookReaderProps) {
    const [page, setPage] = useState(1);
    const [activeNotePage, setActiveNotePage] = useState(1);
    const [zoom, setZoom] = useState(0);
    const [isFocused, setIsFocused] = useState(true);
    const [showScreenshotWarning, setShowScreenshotWarning] = useState(false);
    const [viewMode, setViewMode] = useState<'single' | 'double'>('single');
    const [viewportWidth, setViewportWidth] = useState(800);
    const [viewportHeight, setViewportHeight] = useState(600);
    const [pageAspectRatio, setPageAspectRatio] = useState(4 / 3);
    const pageViewportRef = useRef<HTMLDivElement>(null);

    const ZOOM_MIN = 0;
    const ZOOM_MAX = 100;
    const VIEWPORT_PAD = 32;
    const PAGE_CHROME_X = 22;
    const PAGE_CHROME_Y = 52;
    const dragMovedRef = useRef(false);
    const pinchStartDistRef = useRef(0);
    const pinchStartZoomRef = useRef(0);

    const [notes, setNotes] = useState<BookNote[]>([]);
    const [showSidebar, setShowSidebar] = useState(false);
    const [sidebarTab, setSidebarTab] = useState<"page" | "all">("page");

    const [allNotesSearch, setAllNotesSearch] = useState("");
    const [allNotesPageFilter, setAllNotesPageFilter] = useState("");

    const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
    const [viewingNote, setViewingNote] = useState<BookNote | null>(null);
    const [isQuickNoteModalOpen, setIsQuickNoteModalOpen] = useState(false);
    const [quickNoteTitle, setQuickNoteTitle] = useState("");
    const [quickNoteText, setQuickNoteText] = useState("");
    const [editingQuickNoteId, setEditingQuickNoteId] = useState<string | null>(null);

    const [totalPages, setTotalPages] = useState(0);
    const [pdfLoading, setPdfLoading] = useState(true);
    const [pdfError, setPdfError] = useState<string | null>(null);
    const pdfDocRef = useRef<PDFDocument | null>(null);
    const pageButtonRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

    const getPdfDoc = useCallback(() => pdfDocRef.current, []);

    const [showPageBrowser, setShowPageBrowser] = useState(false);
    const [showTocPanel, setShowTocPanel] = useState(false);
    const [pageJumpInput, setPageJumpInput] = useState("1");
    const [pageBrowserFilter, setPageBrowserFilter] = useState("");
    const [showReAuth, setShowReAuth] = useState(false);
    const [reauthEmail, setReauthEmail] = useState("");
    const [reauthError, setReauthError] = useState("");
    const reauthAttemptsRef = useRef(0);
    const lastReAuthRef = useRef(Date.now());
    const REAUTH_INTERVAL = 30 * 60 * 1000;

    useEffect(() => {
        if (!userId) return;
        (async () => {
            try {
                const loaded = await loadNotes(userId, book.id);
                setNotes(loaded);
            } catch (error) {
                console.error("Failed to load notes:", error);
            }
        })();
    }, [userId, book.id]);

    useEffect(() => {
        if (initialPage && initialPage >= 1 && totalPages > 0 && initialPage <= totalPages) {
            setPage(initialPage);
            setActiveNotePage(initialPage);
        }
    }, [initialPage, totalPages]);

    useEffect(() => {
        let cancelled = false;

        const loadPdf = async () => {
            setPdfLoading(true);
            setPdfError(null);
            setPage(1);
            setActiveNotePage(1);
            pdfDocRef.current?.destroy();
            pdfDocRef.current = null;
            setTotalPages(0);

            const timeoutId = setTimeout(() => {
                if (!cancelled) {
                    setPdfError("Your device is currently not supported. We're working on expanding compatibility. Sorry for the inconvenience.");
                    setPdfLoading(false);
                }
            }, 10000);

            try {
                if (!userId) {
                    throw new Error("Missing user context. Please log in again.");
                }
                const data = await getBookPdf(userId, book.id);
                if (!data) {
                    throw new Error("Download this book from My Collection before reading offline.");
                }
                const doc = await openPdfDocument(data);
                clearTimeout(timeoutId);
                if (cancelled) {
                    doc.destroy();
                    return;
                }
                pdfDocRef.current = doc;
                setTotalPages(doc.numPages);
            } catch (err: unknown) {
                clearTimeout(timeoutId);
                const message = err instanceof Error ? err.message : "Failed to open book.";
                if (!cancelled) setPdfError(message);
            } finally {
                if (!cancelled) setPdfLoading(false);
            }
        };

        loadPdf();
        return () => {
            cancelled = true;
            pdfDocRef.current?.destroy();
            pdfDocRef.current = null;
        };
    }, [userId, book.id]);

    useEffect(() => {
        const el = pageViewportRef.current;
        if (!el) return;
        const measure = () => {
            setViewportWidth(el.clientWidth);
            setViewportHeight(el.clientHeight);
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [showSidebar, pdfLoading, pdfError, totalPages, viewMode]);

    useEffect(() => {
        let cancelled = false;
        const doc = pdfDocRef.current;
        if (!doc || pdfLoading || page < 1) return;

        (async () => {
            try {
                const pdfPage = await doc.getPage(page);
                if (cancelled) return;
                const vp = pdfPage.getViewport({ scale: 1 });
                setPageAspectRatio(vp.height / vp.width);
            } catch {
                /* keep previous aspect ratio */
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [page, pdfLoading, totalPages]);

    useEffect(() => {
        const el = pageViewportRef.current;
        if (!el || pdfLoading || pdfError) return;

        const onWheel = (e: WheelEvent) => {
            const target = e.target as Node;
            if (!el.contains(target)) return;
            e.preventDefault();
            const step = e.deltaY < 0 ? 10 : -10;
            setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z + step)));
        };

        el.addEventListener("wheel", onWheel, { passive: false, capture: true });
        return () => el.removeEventListener("wheel", onWheel, { capture: true });
    }, [pdfLoading, pdfError, ZOOM_MIN, ZOOM_MAX]);

    useEffect(() => {
        setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)));
    }, [viewportWidth, viewportHeight, viewMode]);

    useEffect(() => {
        const el = pageViewportRef.current;
        if (!el || pdfLoading || pdfError) return;

        let dragging = false;
        let startX = 0;
        let startY = 0;
        let startScrollLeft = 0;
        let startScrollTop = 0;

        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            const target = e.target as HTMLElement;
            if (target.closest("button")) return;
            if (
                !target.closest(".drm-page-block") &&
                !target.closest(".drm-page-scroll-content")
            ) {
                return;
            }

            dragging = true;
            dragMovedRef.current = false;
            startX = e.clientX;
            startY = e.clientY;
            startScrollLeft = el.scrollLeft;
            startScrollTop = el.scrollTop;
            el.style.cursor = "grabbing";
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMovedRef.current = true;
            el.scrollLeft = startScrollLeft - dx;
            el.scrollTop = startScrollTop - dy;
        };

        const endDrag = () => {
            if (!dragging) return;
            dragging = false;
            el.style.cursor = "";
            window.setTimeout(() => {
                dragMovedRef.current = false;
            }, 0);
        };

        el.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", endDrag);
        return () => {
            el.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", endDrag);
        };
    }, [pdfLoading, pdfError, page, zoom]);

    useEffect(() => {
        pageViewportRef.current?.scrollTo({ top: 0, left: 0 });
    }, [page, viewMode]);

    useEffect(() => {
        if (viewMode === "double" && page % 2 === 0) {
            setPage((p) => p - 1);
        }
    }, [viewMode]);

    const pageLayout = useMemo(() => {
        const gap = viewMode === "double" ? 12 : 0;
        const availW =
            viewMode === "double"
                ? (viewportWidth - VIEWPORT_PAD - gap) / 2 - PAGE_CHROME_X
                : viewportWidth - VIEWPORT_PAD - PAGE_CHROME_X;
        const availH = viewportHeight - VIEWPORT_PAD - PAGE_CHROME_Y;
        const aspect = pageAspectRatio > 0 ? pageAspectRatio : 4 / 3;

        const widthAtHeightFit = availH / aspect;
        const widthAtWidthFit = availW;
        const t = zoom / 100;
        const displayWidth = widthAtHeightFit + t * (widthAtWidthFit - widthAtHeightFit);

        return { displayWidth: Math.max(80, displayWidth) };
    }, [viewportWidth, viewportHeight, viewMode, pageAspectRatio, zoom]);

    const rightPageNum = viewMode === "double" && page + 1 <= totalPages ? page + 1 : null;

    const watermarkRepeatLines = useMemo(() => {
        const name =
            studentName?.trim() ||
            book.student_name?.trim() ||
            "Licensed student";
        const email = studentEmail?.trim() || book.student_email?.trim() || "";
        const parts = ["Copyright CouldShelf", name];
        if (email) parts.push(email);
        return parts;
    }, [studentName, studentEmail, book.student_name, book.student_email]);

    const watermarkCorner = useMemo(() => {
        const name =
            studentName?.trim() ||
            book.student_name?.trim() ||
            "Licensed student";
        const email = studentEmail?.trim() || book.student_email?.trim() || "";
        const parts = ["Copyright CouldShelf", name];
        if (email) parts.push(email);
        return parts.join(" · ");
    }, [studentName, studentEmail, book.student_name, book.student_email]);

    useEffect(() => {
        lastReAuthRef.current = Date.now();

        const cleanupDevTools = startDevToolsDetection(() => {
            setIsFocused(false);
        });

        const cleanupIntegrity = startContentIntegrityCheck(() => {
            setIsFocused(false);
        });

        const cleanupOverlay = startOverlayDetection(() => {
            setIsFocused(false);
        });

        const reAuthTimer = setInterval(() => {
            if (Date.now() - lastReAuthRef.current > REAUTH_INTERVAL) {
                if (navigator.onLine) {
                    // Online: verify device binding still valid
                    getLeftThumb().then(async (fingerprint) => {
                        const { data: bindResult, error: rpcError } = await supabase
                            .rpc("check_device_binding", {
                                p_user_id: userId,
                                p_left_thumb: fingerprint,
                            });
                        if (rpcError || bindResult === 'blocked') {
                            clearDeviceVerificationCache();
                            setIsFocused(false);
                            showToast("MULTIPLE DEVICE LOGIN DETECTED\nYour account has been locked.", "error");
                            return;
                        }
                        cacheDeviceVerification(fingerprint);
                        lastReAuthRef.current = Date.now();
                    }).catch(() => {
                        showToast("Device verification unavailable.", "error");
                    });
                } else if (!showReAuth) {
                    // Offline: trigger password re-auth as before
                    const user = getCachedUser(userId);
                    if (user) {
                        setReauthEmail(user.email);
                        setShowReAuth(true);
                    }
                }
            }
        }, 60000);

        // Native focus/blur from Tauri window events (more reliable than JS visibility)
        let unlistenFocus: (() => void) | undefined;
        (async () => {
            try {
                const { getCurrentWindow } = await import("@tauri-apps/api/window");
                unlistenFocus = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
                    setIsFocused(focused);
                });
            } catch {
                /* not running in Tauri */
            }
        })();

        return () => {
            cleanupDevTools();
            cleanupIntegrity();
            cleanupOverlay();
            clearInterval(reAuthTimer);
            unlistenFocus?.();
        };
    }, []);

    const persistNotes = (updated: BookNote[]) => {
        setNotes(updated);
        if (!userId) {
            showToast("Cannot save notes: missing user context.", "error");
            return;
        }
        try {
            saveNotes(userId, book.id, updated);
        } catch (error) {
            console.error("Failed to save notes:", error);
                showToast("Failed to save notes. Your changes may not persist.", "error");
        }
    };

    const handleReAuth = async () => {
        const input = document.getElementById("reauth-password") as HTMLInputElement;
        const password = input?.value;
        if (!password) { setReauthError("Password is required"); return; }
        try {
            await verifyOfflineCredentials(reauthEmail, password);
            setShowReAuth(false);
            setReauthError("");
            reauthAttemptsRef.current = 0;
            lastReAuthRef.current = Date.now();
            if (input) input.value = "";
        } catch (e: unknown) {
            setReauthError(e instanceof Error ? e.message : "Invalid password");
            reauthAttemptsRef.current += 1;
            if (reauthAttemptsRef.current >= 3) {
                setShowReAuth(false);
                setIsFocused(false);
                reauthAttemptsRef.current = 0;
            }
        }
    };

    const notesForCurrentPage = notes
        .filter((n) => n.page === activeNotePage)
        .sort((a, b) => b.createdAt - a.createdAt);

    const filteredAllNotes = notes
        .filter((n) => {
            if (allNotesPageFilter !== "" && n.page !== parseInt(allNotesPageFilter, 10)) return false;
            if (allNotesSearch.trim()) {
                const q = allNotesSearch.toLowerCase();
                const text = stripHtmlText(n.text).toLowerCase();
                return text.includes(q) || String(n.page).includes(q);
            }
            return true;
        })
        .sort((a, b) => a.page - b.page || b.createdAt - a.createdAt);

    const pagesWithNotes = useMemo(() => new Set(notes.map((n) => n.page)), [notes]);

    const browserPageNumbers = useMemo(() => {
        const q = pageBrowserFilter.trim();
        return Array.from({ length: totalPages }, (_, i) => i + 1).filter(
            (p) => !q || String(p).includes(q)
        );
    }, [totalPages, pageBrowserFilter]);

    const goToPage = (target: number) => {
        if (totalPages < 1) return;
        const p = Math.max(1, Math.min(totalPages, Math.round(target)));
        if (viewMode === "double") {
            setPage(p % 2 === 0 ? p - 1 : p);
        } else {
            setPage(p);
        }
        setActiveNotePage(p);
        setPageJumpInput(String(p));
        setShowPageBrowser(false);
    };

    const renderTocEntries = (entries: TOCEntry[], depth: number): React.ReactNode => {
        return entries.map((entry, i) => (
            <div key={`${depth}-${i}`}>
                <button
                    onClick={() => {
                        goToPage(entry.page);
                        setShowTocPanel(false);
                    }}
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        width: "100%",
                        padding: "8px 16px",
                        paddingLeft: `${16 + depth * 20}px`,
                        background: "none",
                        border: "none",
                        color: depth === 0 ? "#e0e0e0" : "#aaa",
                        fontSize: depth === 0 ? "0.85rem" : "0.8rem",
                        fontWeight: depth === 0 ? 600 : 400,
                        cursor: "pointer",
                        textAlign: "left",
                        boxShadow: "none",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#2a2a2a")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entry.title}
                    </span>
                    <span style={{ color: "#666", fontSize: "0.75rem", marginLeft: "8px", whiteSpace: "nowrap" }}>
                        p. {entry.page}
                    </span>
                </button>
                {entry.children && entry.children.length > 0 && renderTocEntries(entry.children, depth + 1)}
            </div>
        ));
    };

    const handlePageJumpSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        const n = parseInt(pageJumpInput, 10);
        if (!Number.isNaN(n)) goToPage(n);
    };

    const togglePageBrowser = () => {
        setShowPageBrowser((open) => {
            if (!open) setPageJumpInput(String(page));
            return !open;
        });
    };

    useEffect(() => {
        if (!showPageBrowser) return;
        setPageJumpInput(String(page));
        const timer = window.setTimeout(() => {
            pageButtonRefs.current.get(page)?.scrollIntoView({ block: "nearest", inline: "center" });
        }, 50);
        return () => window.clearTimeout(timer);
    }, [showPageBrowser, page]);

    const nextPage = () => {
        if (viewMode === "single") {
            if (page < totalPages) {
                const next = page + 1;
                setPage(next);
                setActiveNotePage(next);
            }
        } else {
            const nextLeft = page + 2;
            if (nextLeft <= totalPages) {
                setPage(nextLeft);
                setActiveNotePage(nextLeft);
            }
        }
    };

    const prevPage = () => {
        if (viewMode === "single") {
            if (page > 1) {
                const prev = page - 1;
                setPage(prev);
                setActiveNotePage(prev);
            }
        } else {
            if (page > 1) {
                const prevLeft = Math.max(1, page - 2);
                setPage(prevLeft);
                setActiveNotePage(prevLeft);
            }
        }
    };

    const canGoNext =
        totalPages > 0 &&
        (viewMode === "single" ? page < totalPages : page + 2 <= totalPages);

    const handleViewportDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (dragMovedRef.current) return;
        const target = e.target as HTMLElement;
        if (target.closest("button")) return;

        const el = pageViewportRef.current;
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const relX = (e.clientX - rect.left) / rect.width;

        if (relX < 0.35 && page > 1) {
            e.preventDefault();
            prevPage();
        } else if (relX > 0.65 && canGoNext) {
            e.preventDefault();
            nextPage();
        }
    };

    const triggerScreenshotWarning = () => {
        setShowScreenshotWarning(true);
        if (navigator.clipboard) {
            navigator.clipboard.writeText("WARNING: Screenshots are blocked by CloudShelf DRM.");
        }
        setTimeout(() => setShowScreenshotWarning(false), 4000);
    };

    useEffect(() => {
        // 1. Prevent Right-Click (Anti-Copy)
        const handleContextMenu = (e: MouseEvent) => e.preventDefault();

        // 2. Intercept PrintScreen, snipping shortcuts, print/save
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "PrintScreen" || e.keyCode === 44) {
                e.preventDefault();
                triggerScreenshotWarning();
            }
            const key = e.key.toLowerCase();
            if (key === "s" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                triggerScreenshotWarning();
            }
            if ((e.ctrlKey || e.metaKey) && key === "p") {
                e.preventDefault();
                showToast("Printing is disabled to protect copyright.", "warning");
            }
            if ((e.ctrlKey || e.metaKey) && key === "s") {
                e.preventDefault();
            }
        };

        // 3. Hide content when the app window loses focus (snipping / alt-tab)
        const handleWindowBlur = () => {
            setIsFocused(false);
            try {
                navigator.clipboard.writeText("CloudShelf DRM — Content is protected by copyright.");
            } catch {
                /* clipboard may not be available */
            }
        };
        const handleWindowFocus = () => setIsFocused(true);
        const handleVisibility = () => {
            if (document.visibilityState === "hidden") {
                setIsFocused(false);
            } else {
                setIsFocused(true);
            }
        };

        document.addEventListener("contextmenu", handleContextMenu);
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("blur", handleWindowBlur);
        window.addEventListener("focus", handleWindowFocus);
        document.addEventListener("visibilitychange", handleVisibility);

        setIsFocused(true);

        return () => {
            document.removeEventListener("contextmenu", handleContextMenu);
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("blur", handleWindowBlur);
            window.removeEventListener("focus", handleWindowFocus);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, []);

    const handleOpenNoteModal = (note: BookNote) => {
        setViewingNote(note);
        setIsNoteModalOpen(true);
    };

    const startEditNote = (note: BookNote) => {
        if (viewMode === "double") {
            setPage(note.page % 2 === 0 ? note.page - 1 : note.page);
        } else {
            setPage(note.page);
        }
        setActiveNotePage(note.page);
        setQuickNoteTitle(note.title || "");
        setQuickNoteText(note.text);
        setEditingQuickNoteId(note.id);
        setIsQuickNoteModalOpen(true);
        setIsNoteModalOpen(false);
    };

    const deleteNote = (note: BookNote) => {
        if (!window.confirm(`Delete this note from page ${note.page}?`)) return;
        persistNotes(notes.filter((n) => n.id !== note.id));
    };

    const saveQuickNote = () => {
        try {
            const stripped = stripHtmlText(quickNoteText).trim();
            if (!stripped) return;

            let savedNote: BookNote;

            if (editingQuickNoteId) {
                const existing = notes.find(n => n.id === editingQuickNoteId);
                if (!existing) return;
                savedNote = { ...existing, text: quickNoteText, title: quickNoteTitle || undefined };
                persistNotes(notes.map((n) => (n.id === editingQuickNoteId ? savedNote : n)));
            } else {
                savedNote = { id: generateNoteId(), page: activeNotePage, text: quickNoteText, title: quickNoteTitle || undefined, createdAt: Date.now() };
                persistNotes([...notes, savedNote]);
            }

            setIsQuickNoteModalOpen(false);
            setQuickNoteTitle("");
            setQuickNoteText("");
            setEditingQuickNoteId(null);
            setViewingNote(savedNote);
            setIsNoteModalOpen(true);
        } catch (error) {
            console.error("Failed to save quick note:", error);
            showToast("Failed to save note. Please try again.", "error");
        }
    };

    const exportBookNotes = () => {
        if (notes.length === 0) return;
        const sorted = [...notes].sort((a, b) => a.page - b.page);
        const items = sorted.map((n) => ({
            heading: n.title || `Page ${n.page}`,
            date: new Date(n.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
            content: n.text,
        }));
        import("../lib/printNotes").then(({ printNotesAsPdf }) => {
            printNotesAsPdf([{ title: book.title, items }], `Notes — ${book.title}`);
        }).catch(error => { console.error("Failed to load print module:", error); showToast("Failed to export notes. Please try again.", "error"); });
    };

    const renderNoteCard = (note: BookNote, showPageLabel: boolean) => (
        <div
            key={note.id}
            onClick={() => handleOpenNoteModal(note)}
            style={{
                padding: "10px",
                border: "1px solid #eee",
                borderRadius: "6px",
                backgroundColor: "#fafafa",
                fontSize: "0.8rem",
                cursor: "pointer",
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                <div>
                    {showPageLabel && (
                        <div
                            onClick={(e) => { e.stopPropagation(); goToPage(note.page); }}
                            style={{ cursor: "pointer", fontWeight: "bold", color: "#396cd8" }}
                        >
                            Page {note.page}
                        </div>
                    )}
                    {note.title && (
                        <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "#333" }}>{note.title}</div>
                    )}
                </div>
                <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); startEditNote(note); }}
                        title="Edit note"
                        style={{ padding: "4px", border: "none", borderRadius: "4px", backgroundColor: "transparent", color: "#396cd8", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "none" }}
                    >
                        <Pencil size={14} />
                    </button>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); deleteNote(note); }}
                        title="Delete note"
                        style={{ padding: "4px", border: "none", borderRadius: "4px", backgroundColor: "transparent", color: "#d32f2f", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "none" }}
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>
            <div style={{ color: "#555", fontSize: "0.8rem", lineHeight: "1.5" }} dangerouslySetInnerHTML={{ __html: note.text }} />
        </div>
    );

    return (
        <div className="drm-reader-container" style={{ backgroundColor: "#1e1e1e" }}>
            
            {/* Anti-Snipping Blur Shield Overlay */}
            {!isFocused && (
                <div className="drm-blur-overlay">
                    <EyeOff size={60} className="drm-blur-icon" />
                    <h2 style={{ fontSize: "1.5rem", margin: "0 0 10px 0", color: "#ff5252" }}>🔒 DRM PROTECTION ACTIVE</h2>
                    <p style={{ margin: "0", fontSize: "1rem", color: "#aaa", maxWidth: "450px", lineHeight: "1.5" }}>
                        The book view is hidden because the app lost focus.<br/>
                        <strong>Content is watermarked with your account. Screenshots can be traced.</strong>
                    </p>
                </div>
            )}

            {/* PrintScreen Interception Toast Warning */}
            {showScreenshotWarning && (
                <div style={{
                    position: "fixed",
                    top: "80px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    backgroundColor: "#d32f2f",
                    color: "white",
                    padding: "12px 24px",
                    borderRadius: "8px",
                    boxShadow: "0 4px 15px rgba(0,0,0,0.5)",
                    zIndex: 5000,
                    fontWeight: "bold",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px"
                }}>
                    <ShieldAlert size={20} />
                    Screenshots are not allowed to protect this book. Clipboard has been cleared.
                </div>
            )}

            {/* Secure Reader Top Action Bar */}
            <header className="drm-reader-header">
                <div className="drm-reader-header-left">
                    <button 
                        onClick={onClose} 
                        aria-label="Go back"
                        style={{ 
                            background: "none", 
                            border: "none", 
                            color: "#fff", 
                            cursor: "pointer", 
                            padding: "5px",
                            display: "flex",
                            alignItems: "center",
                            boxShadow: "none"
                        }}
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h4 className="drm-reader-header-title">{book.title}</h4>
                        <span style={{ fontSize: "0.7rem", color: "#888" }}>Student DRM License Active</span>
                    </div>
                </div>

                <div className="drm-reader-header-controls">
                    {/* Notes panel toggle */}
                    <button 
                        onClick={() => setViewMode(viewMode === 'single' ? 'double' : 'single')} 
                        style={{ 
                            backgroundColor: "#333", 
                            color: "#fff", 
                            fontSize: "0.8rem", 
                            border: "1px solid #444", 
                            padding: "6px 12px",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px"
                        }}
                        title={viewMode === "single" ? "Show two pages side by side" : "Show one page at a time"}
                    >
                        {viewMode === "single" ? <BookCopy size={14} /> : <Square size={14} />}
                        {viewMode === "single" ? "Split Pages" : "Single Page"}
                    </button>

                    <button 
                        onClick={() => {
                            setQuickNoteTitle("");
                            setQuickNoteText("");
                            setEditingQuickNoteId(null);
                            setIsQuickNoteModalOpen(true);
                        }} 
                        style={{ 
                            backgroundColor: "#2e7d32", 
                            color: "#fff", 
                            fontSize: "0.8rem", 
                            border: "1px solid #388e3c", 
                            padding: "6px 12px",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px"
                        }}
                        title="Add a note for this page"
                    >
                        <Plus size={14} /> Add Note
                    </button>
                </div>
            </header>

            {/* Split Screen Container: Sidebar and Book Viewport */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>

                {/* TOC Trigger Tab */}
                {book.toc && book.toc.length > 0 && (
                    <div
                        onClick={() => setShowTocPanel(p => !p)}
                        style={{
                            position: "absolute",
                            left: showTocPanel ? "300px" : "0",
                            top: "0",
                            zIndex: 101,
                            transition: "left 0.25s ease",
                            cursor: "pointer",
                            backgroundColor: "#1e1e1e",
                            border: "1px solid #333",
                            borderLeft: "none",
                            borderTopRightRadius: "0",
                            borderBottomRightRadius: "6px",
                            padding: "12px 8px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#ccc",
                            boxShadow: "2px 0 8px rgba(0,0,0,0.3)",
                            height: "44px",
                            boxSizing: "border-box",
                        }}
                        title={showTocPanel ? "Close Contents" : "Open Contents"}
                    >
                        {showTocPanel ? <X size={18} /> : <List size={18} />}
                    </div>
                )}

                {/* TOC Slide‑out Panel */}
                <div
                    style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: "300px",
                        backgroundColor: "#1e1e1e",
                        borderRight: "1px solid #333",
                        zIndex: 100,
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                        transform: showTocPanel ? "translateX(0)" : "translateX(-100%)",
                        transition: "transform 0.25s ease",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "12px 16px",
                            borderBottom: "1px solid #333",
                        }}
                    >
                        <span style={{ color: "#fff", fontWeight: 600, fontSize: "0.9rem" }}>Table Of Content</span>
                    </div>
                    <div style={{ overflowY: "auto", flex: 1, padding: "8px 0" }}>
                        {book.toc && book.toc.length > 0 ? renderTocEntries(book.toc, 0) : (
                            <p style={{ color: "#666", padding: "16px", textAlign: "center", fontSize: "0.85rem" }}>No table of contents</p>
                        )}
                    </div>
                </div>
                
                {/* Book Content Page Viewport */}
                <div className="drm-reader-content" style={{ backgroundColor: "#2b2b2b" }}>
                    {pdfLoading && (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: "16px" }}>
                            <div style={{ width: "40px", height: "40px", border: "4px solid #e0e0e0", borderTop: "4px solid #396cd8", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                            <p style={{ color: "#888", fontSize: "0.9rem" }}>Loading book...</p>
                        </div>
                    )}
                    {pdfError && !pdfLoading && (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#ff8a80", padding: "24px", textAlign: "center", gap: "16px" }}>
                            <p style={{ margin: 0, maxWidth: "420px" }}>{pdfError}</p>
                            <button type="button" onClick={onClose} style={{ backgroundColor: "#396cd8", color: "#fff", border: "none", padding: "10px 20px", borderRadius: "6px" }}>
                                Back to collection
                            </button>
                        </div>
                    )}
                    {!pdfLoading && !pdfError && totalPages > 0 && (
                        <div
                            ref={pageViewportRef}
                            className="drm-page-viewport"
                            onDoubleClick={handleViewportDoubleClick}
                            title="Double-click left or right edge to turn pages"
                            onTouchStart={(e) => {
                                if (e.touches.length === 2) {
                                    const t = e.touches;
                                    pinchStartDistRef.current = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
                                    pinchStartZoomRef.current = zoom;
                                }
                            }}
                            onTouchMove={(e) => {
                                if (e.touches.length === 2) {
                                    e.preventDefault();
                                    const t = e.touches;
                                    const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
                                    const ratio = dist / pinchStartDistRef.current;
                                    setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(pinchStartZoomRef.current + (ratio - 1) * 100))));
                                }
                            }}
                            onTouchEnd={() => {
                                pinchStartDistRef.current = 0;
                            }}
                        >
                            <div className="drm-page-scroll-content">
                            <div className={`drm-spread-row${viewMode === "single" ? " single" : ""}`}>
                                <ReaderPageCanvas
                                    pageNum={page}
                                    displayWidth={pageLayout.displayWidth}
                                    getPdfDoc={getPdfDoc}
                                    isActive={activeNotePage === page}
                                    onSelect={() => setActiveNotePage(page)}
                                    dragMovedRef={dragMovedRef}
                                    watermarkLines={watermarkRepeatLines}
                                    watermarkCorner={watermarkCorner}
                                    userIdForNoise={userId}
                                    bookIdForNoise={book.id}
                                />
                                {viewMode === "double" && rightPageNum !== null && (
                                    <ReaderPageCanvas
                                        pageNum={rightPageNum}
                                        displayWidth={pageLayout.displayWidth}
                                        getPdfDoc={getPdfDoc}
                                        isActive={activeNotePage === rightPageNum}
                                        onSelect={() => setActiveNotePage(rightPageNum)}
                                        dragMovedRef={dragMovedRef}
                                        watermarkLines={watermarkRepeatLines}
                                        watermarkCorner={watermarkCorner}
                                        userIdForNoise={userId}
                                        bookIdForNoise={book.id}
                                    />
                                )}
                            </div>
                            </div>
                        </div>
                    )}

                    {!pdfLoading && !pdfError && totalPages > 0 && (
                        <div className="drm-zoom-toolbar" role="toolbar" aria-label="Zoom">
                            <button
                                type="button"
                                onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - 10))}
                                disabled={zoom <= ZOOM_MIN}
                                title="Zoom out (fit full page height)"
                            >
                                <ZoomOut size={16} />
                            </button>
                            <span className="drm-zoom-toolbar-label" title={zoom <= 0 ? "Full height" : zoom >= 100 ? "Full width" : "Between height and width fit"}>
                                {zoom}%
                            </span>
                            <button
                                type="button"
                                onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + 10))}
                                disabled={zoom >= ZOOM_MAX}
                                title="Zoom in (fit full page width)"
                            >
                                <ZoomIn size={16} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setZoom(0)}
                                title="Reset zoom (fit full height)"
                            >
                                <RotateCcw size={16} />
                            </button>
                        </div>
                    )}
                </div>

                {/* Notes Trigger Tab */}
                <div
                    onClick={() => setShowSidebar(p => !p)}
                    style={{
                        position: "absolute",
                        right: showSidebar ? "350px" : "0",
                        top: "0",
                        zIndex: 101,
                        transition: "right 0.25s ease",
                        cursor: "pointer",
                        backgroundColor: "#fff",
                        border: "1px solid #ccc",
                        borderRight: "none",
                        borderTopLeftRadius: "0",
                        borderBottomLeftRadius: "6px",
                        padding: "12px 8px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#555",
                        boxShadow: "-2px 0 8px rgba(0,0,0,0.1)",
                        height: "44px",
                        boxSizing: "border-box",
                    }}
                    title={showSidebar ? "Close Notes" : "Open Notes"}
                >
                    {showSidebar ? <X size={18} /> : <MessageSquare size={18} />}
                </div>

                {/* Notes Slide‑out Panel */}
                <aside style={{
                    position: "absolute",
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: "350px",
                    backgroundColor: "#ffffff",
                    borderLeft: "1px solid #333",
                    zIndex: 100,
                    display: "flex",
                    flexDirection: "column",
                    color: "#333",
                    boxShadow: showSidebar ? "-4px 0 10px rgba(0,0,0,0.1)" : "none",
                    transform: showSidebar ? "translateX(0)" : "translateX(100%)",
                    transition: "transform 0.25s ease",
                }}>
                        {/* Sidebar Tabs */}
                        <div style={{ display: "flex", borderBottom: "1px solid #eee", backgroundColor: "#f5f5f5" }}>
                            <button
                                style={{
                                    flex: 1,
                                    padding: "12px",
                                    background: "none",
                                    border: "none",
                                    borderBottom: sidebarTab === "page" ? "3px solid #396cd8" : "none",
                                    color: sidebarTab === "page" ? "#396cd8" : "#888",
                                    fontWeight: "bold",
                                    cursor: "pointer",
                                    fontSize: "0.85rem",
                                    boxShadow: "none"
                                }}
                                onClick={() => setSidebarTab("page")}
                            >
                                This Page ({notesForCurrentPage.length})
                            </button>
                            <button
                                style={{
                                    flex: 1,
                                    padding: "12px",
                                    background: "none",
                                    border: "none",
                                    borderBottom: sidebarTab === "all" ? "3px solid #396cd8" : "none",
                                    color: sidebarTab === "all" ? "#396cd8" : "#888",
                                    fontWeight: "bold",
                                    cursor: "pointer",
                                    fontSize: "0.85rem",
                                    boxShadow: "none"
                                }}
                                onClick={() => setSidebarTab("all")}
                            >
                                All Notes ({notes.length})
                            </button>
                        </div>

                        {/* Sidebar Scroll Content */}
                        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
                            {sidebarTab === "page" ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                                    <div>
                                        <h4 style={{ margin: "0 0 10px 0", fontSize: "0.95rem", fontWeight: "700" }}>
                                            Notes on this page
                                        </h4>
                                        {notesForCurrentPage.length === 0 ? (
                                            <p style={{ fontSize: "0.8rem", color: "#888", fontStyle: "italic" }}>
                                                No notes on page {activeNotePage} yet.
                                            </p>
                                        ) : (
                                            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                                {notesForCurrentPage.map((note) => renderNoteCard(note, false))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
                                    <h4 style={{ margin: "0", fontSize: "0.95rem", fontWeight: "700" }}>All notes in this book</h4>

                                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                        <div style={{ position: "relative" }}>
                                            <Search
                                                size={14}
                                                style={{
                                                    position: "absolute",
                                                    left: "10px",
                                                    top: "50%",
                                                    transform: "translateY(-50%)",
                                                    color: "#888",
                                                    pointerEvents: "none",
                                                }}
                                            />
                                            <input
                                                type="search"
                                                placeholder="Search notes..."
                                                value={allNotesSearch}
                                                onChange={(e) => setAllNotesSearch(e.target.value)}
                                                style={{
                                                    width: "100%",
                                                    padding: "6px 10px 6px 32px",
                                                    border: "1px solid #ccc",
                                                    borderRadius: "6px",
                                                    fontSize: "0.8rem",
                                                    boxSizing: "border-box",
                                                    backgroundColor: "#fff",
                                                    color: "#000",
                                                }}
                                            />
                                        </div>
                                        <select
                                            value={allNotesPageFilter}
                                            onChange={(e) => setAllNotesPageFilter(e.target.value)}
                                            style={{
                                                width: "100%",
                                                padding: "8px 10px",
                                                border: "1px solid #ccc",
                                                borderRadius: "6px",
                                                fontSize: "0.85rem",
                                                backgroundColor: "#fff",
                                                color: "#000",
                                            }}
                                        >
                                            <option value="">All pages</option>
                                            {Array.from({ length: totalPages || 0 }, (_, i) => i + 1).map((p) => (
                                                <option key={p} value={String(p)}>
                                                    Page {p}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {notes.length === 0 ? (
                                        <p style={{ fontSize: "0.8rem", color: "#888", fontStyle: "italic" }}>
                                            No notes saved for this book.
                                        </p>
                                    ) : filteredAllNotes.length === 0 ? (
                                        <p style={{ fontSize: "0.8rem", color: "#888", fontStyle: "italic" }}>
                                            No notes match your filters.
                                        </p>
                                    ) : (
                                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                            {filteredAllNotes.map((note) => renderNoteCard(note, true))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div style={{ 
                            padding: "15px", 
                            borderTop: "1px solid #eee", 
                            backgroundColor: "#f9f9f9",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                        }}>
                            <button
                                type="button"
                                onClick={exportBookNotes}
                                disabled={notes.length === 0}
                                style={{
                                    width: "100%",
                                    padding: "8px",
                                    backgroundColor: notes.length > 0 ? "#396cd8" : "#888",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: "6px",
                                    fontSize: "0.8rem",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "6px",
                                    cursor: notes.length > 0 ? "pointer" : "not-allowed",
                                    opacity: notes.length > 0 ? 1 : 0.5,
                                }}
                            >
                                <Printer size={14} /> Export notes for this book
                            </button>
                            <div style={{ fontSize: "0.7rem", color: "#888", textAlign: "center" }}>
                                Notes are stored on this device only and must not be shared.
                            </div>
                        </div>
                    </aside>
            </div>

            {/* Bottom navigation + page browser */}
            <div style={{ flexShrink: 0, zIndex: 3001, position: "relative" }}>
                {showPageBrowser && totalPages > 0 && (
                    <div
                        style={{
                            backgroundColor: "#1a1a1a",
                            borderTop: "1px solid #333",
                            maxHeight: "min(42vh, 320px)",
                            display: "flex",
                            flexDirection: "column",
                            boxShadow: "0 -8px 24px rgba(0,0,0,0.35)",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "10px 16px",
                                borderBottom: "1px solid #333",
                                gap: "12px",
                                flexWrap: "wrap",
                            }}
                        >
                            <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#eee" }}>
                                Page browser
                            </span>
                            <button
                                type="button"
                                onClick={() => setShowPageBrowser(false)}
                                style={{ background: "none", border: "none", color: "#aaa", padding: "4px", boxShadow: "none" }}
                                aria-label="Close page browser"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: "10px", borderBottom: "1px solid #333" }}>
                            <form onSubmit={handlePageJumpSubmit} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                <label htmlFor="goto-page-input" style={{ fontSize: "0.8rem", color: "#aaa", whiteSpace: "nowrap" }}>Go to page</label>
                                <input
                                    id="goto-page-input"
                                    type="number"
                                    min={1}
                                    max={totalPages}
                                    value={pageJumpInput}
                                    onChange={(e) => setPageJumpInput(e.target.value)}
                                    style={{
                                        width: "72px",
                                        padding: "6px 8px",
                                        borderRadius: "6px",
                                        border: "1px solid #444",
                                        backgroundColor: "#222",
                                        color: "#fff",
                                        fontSize: "0.9rem",
                                    }}
                                />
                                <span style={{ fontSize: "0.8rem", color: "#666" }}>of {totalPages}</span>
                                <button
                                    type="submit"
                                    style={{
                                        backgroundColor: "#396cd8",
                                        color: "#fff",
                                        border: "none",
                                        padding: "6px 14px",
                                        borderRadius: "6px",
                                        fontSize: "0.8rem",
                                        fontWeight: 600,
                                    }}
                                >
                                    Go
                                </button>
                            </form>
                            <div style={{ position: "relative" }}>
                                <Search
                                    size={14}
                                    style={{
                                        position: "absolute",
                                        left: "10px",
                                        top: "50%",
                                        transform: "translateY(-50%)",
                                        color: "#666",
                                        pointerEvents: "none",
                                    }}
                                />
                                <input
                                    type="search"
                                    placeholder="Filter page numbers..."
                                    value={pageBrowserFilter}
                                    onChange={(e) => setPageBrowserFilter(e.target.value)}
                                    style={{
                                        width: "100%",
                                        padding: "6px 10px 6px 32px",
                                        borderRadius: "6px",
                                        border: "1px solid #444",
                                        backgroundColor: "#222",
                                        color: "#fff",
                                        fontSize: "0.85rem",
                                        boxSizing: "border-box",
                                    }}
                                />
                            </div>
                        </div>

                        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
                            {browserPageNumbers.length === 0 ? (
                                <p style={{ margin: 0, fontSize: "0.8rem", color: "#888", textAlign: "center" }}>
                                    No pages match your filter.
                                </p>
                            ) : (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                    {browserPageNumbers.map((p) => {
                                        const isCurrent = p === page;
                                        const hasNote = pagesWithNotes.has(p);
                                        return (
                                            <button
                                                key={p}
                                                type="button"
                                                ref={(el) => {
                                                    if (el) pageButtonRefs.current.set(p, el);
                                                    else pageButtonRefs.current.delete(p);
                                                }}
                                                onClick={() => goToPage(p)}
                                                title={hasNote ? `Page ${p} (has notes)` : `Page ${p}`}
                                                style={{
                                                    minWidth: "44px",
                                                    height: "40px",
                                                    padding: "0 10px",
                                                    borderRadius: "6px",
                                                    border: isCurrent ? "2px solid #396cd8" : "1px solid #444",
                                                    backgroundColor: isCurrent ? "#396cd8" : "#2a2a2a",
                                                    color: isCurrent ? "#fff" : "#ccc",
                                                    fontSize: "0.85rem",
                                                    fontWeight: isCurrent ? 700 : 500,
                                                    cursor: "pointer",
                                                    position: "relative",
                                                    boxShadow: "none",
                                                }}
                                            >
                                                {p}
                                                {hasNote && (
                                                    <span
                                                        style={{
                                                            position: "absolute",
                                                            top: "4px",
                                                            right: "4px",
                                                            width: "6px",
                                                            height: "6px",
                                                            borderRadius: "50%",
                                                            backgroundColor: isCurrent ? "#fff" : "#ffc107",
                                                        }}
                                                    />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <footer
                    style={{
                        height: "50px",
                        backgroundColor: "#111",
                        borderTop: "1px solid #333",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "16px",
                    }}
                >
                    <button
                        disabled={page === 1}
                        onClick={prevPage}
                        aria-label="Previous page"
                        style={{ background: "#222", border: "1px solid #333", color: "#fff", padding: "4px 12px", display: "flex", alignItems: "center", gap: "5px" }}
                    >
                        <ChevronLeft size={16} /> Previous
                    </button>

                    <button
                        type="button"
                        onClick={togglePageBrowser}
                        disabled={totalPages < 1 || pdfLoading || !!pdfError}
                        aria-label="Toggle page browser"
                        style={{
                            background: showPageBrowser ? "#396cd8" : "#222",
                            border: "1px solid #333",
                            color: "#fff",
                            padding: "4px 12px",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "0.85rem",
                            cursor: totalPages > 0 ? "pointer" : "not-allowed",
                            opacity: totalPages > 0 ? 1 : 0.5,
                        }}
                        title="Jump to a page"
                    >
                        <LayoutGrid size={15} />
                        {viewMode === "single" ? (
                            <>
                                Page <strong>{page}</strong> / {totalPages}
                            </>
                        ) : (
                            <>
                                Pages <strong>{page}{rightPageNum ? `–${rightPageNum}` : ""}</strong> / {totalPages}
                            </>
                        )}
                    </button>

                    <button
                        disabled={!canGoNext}
                        onClick={nextPage}
                        aria-label="Next page"
                        style={{ background: "#222", border: "1px solid #333", color: "#fff", padding: "4px 12px", display: "flex", alignItems: "center", gap: "5px" }}
                    >
                        Next <ChevronRight size={16} />
                    </button>
                </footer>
            </div>

            {/* Quick Add Note Modal */}
            {isQuickNoteModalOpen && (
                <div className="modal-overlay" style={{ zIndex: 6000 }}>
                    <div className="modal-content" style={{ width: '80%', height: '80vh', display: 'flex', flexDirection: 'column', resize: 'both', overflow: 'hidden', padding: 0 }}>
                        <div className="modal-header" style={{ gap: '12px', marginBottom: 0, padding: '12px 20px 10px', borderBottom: 'none' }}>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <FileText size={20} color="#396cd8" />
                                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#555', whiteSpace: 'nowrap' }}>Note For Page {activeNotePage}</span>
                                <div style={{ width: '1px', height: '24px', backgroundColor: '#ddd' }} />
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder="Note title (optional)"
                                    value={quickNoteTitle}
                                    onChange={e => setQuickNoteTitle(e.target.value)}
                                    style={{ flex: 1, fontWeight: 600, fontSize: '1rem', padding: '6px 10px' }}
                                />
                            </div>
                            <button className="close-btn" onClick={() => { setIsQuickNoteModalOpen(false); setQuickNoteTitle(""); setQuickNoteText(""); setEditingQuickNoteId(null); }}><X size={20} /></button>
                        </div>
                        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <SimpleRichEditor
                                value={quickNoteText}
                                onChange={setQuickNoteText}
                                placeholder="Write your note..."
                                fillHeight
                            />
                        </div>
                        <div className="modal-footer" style={{ padding: '12px 20px 20px', textAlign: 'right' }}>
                            <button type="button" className="btn btn-primary" onClick={saveQuickNote} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                <Save size={16} /> {editingQuickNoteId ? "Update" : "Add Note"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Note Pop-up Modal */}
            {isNoteModalOpen && viewingNote && (
                <div className="modal-overlay" style={{ zIndex: 6000 }}>
                    <div className="modal-content" style={{ width: '80%', height: '80vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
                        <div className="modal-header" style={{ padding: "15px 20px", display: "flex", alignItems: "center", gap: "10px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                                <FileText size={20} color="#396cd8" />
                                <span style={{ fontWeight: 700, fontSize: "1rem", color: "#333", whiteSpace: "nowrap" }}>Note — Page {viewingNote.page}</span>
                                {viewingNote.title ? (
                                    <span style={{ color: "#999" }}>—</span>
                                ) : null}
                                {viewingNote.title ? (
                                    <span style={{ fontWeight: 600, fontSize: "0.95rem", color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{viewingNote.title}</span>
                                ) : null}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                                <button
                                    className="btn btn-primary"
                                    style={{ backgroundColor: "#396cd8", color: "#fff", border: "none", padding: "6px 14px", fontWeight: "bold", display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", borderRadius: "6px", cursor: "pointer", whiteSpace: "nowrap" }}
                                    onClick={() => startEditNote(viewingNote)}
                                >
                                    <Save size={14} /> Edit
                                </button>
                                <button className="close-btn" onClick={() => setIsNoteModalOpen(false)}>
                                    <X size={20} />
                                </button>
                            </div>
                        </div>
                        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px", fontSize: "0.9rem", color: "#333", lineHeight: "1.6" }}
                            dangerouslySetInnerHTML={{ __html: viewingNote.text }}
                        />
                    </div>
                </div>
            )}

            {/* Session Re-authentication Modal */}
            {showReAuth && (
                <div className="modal-overlay" style={{ zIndex: 7000 }}>
                    <div className="modal-content" style={{ width: "400px" }}>
                        <div className="modal-header">
                            <h4 style={{ margin: 0, color: "#ff5252" }}>Session Expired</h4>
                        </div>
                        <div style={{ padding: "20px" }}>
                            <p>Please re-enter your password to continue reading.</p>
                            <input
                                type="email"
                                value={reauthEmail}
                                disabled
                                style={{ width: "100%", padding: "10px", marginBottom: "10px", boxSizing: "border-box" }}
                            />
                            <input
                                id="reauth-password"
                                type="password"
                                placeholder="Password"
                                style={{ width: "100%", padding: "10px", marginBottom: "10px", boxSizing: "border-box" }}
                                onKeyDown={(e) => { if (e.key === "Enter") handleReAuth(); }}
                                autoFocus
                            />
                            {reauthError && <p style={{ color: "#ff5252", fontSize: "0.85rem" }}>{reauthError}</p>}
                            {reauthAttemptsRef.current > 0 && (
                                <p style={{ color: "#ffab00", fontSize: "0.8rem" }}>
                                    Attempt {reauthAttemptsRef.current}/3
                                </p>
                            )}
                            <div style={{ display: "flex", gap: "10px", marginTop: "15px" }}>
                                <button
                                    style={{ flex: 1 }}
                                    onClick={() => { setShowReAuth(false); setIsFocused(false); }}
                                >
                                    Lock Book
                                </button>
                                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleReAuth}>
                                    Verify
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
