import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { Session } from "@supabase/supabase-js";
import { Download, BookOpen, Trash2 } from "lucide-react";
import {
    downloadBookFile,
    downloadBookCover,
    getBookCoverBlob,
    getBookFilePath,
    listDownloadedBookIds,
    removeBookDownload,
} from "../lib/offlineBooks";
import { showToast } from "../lib/toast";
import { cacheOwnedBooks, getCachedOwnedBooks } from "../lib/offlineAuth";
import type { Book } from "../types";

interface MyCollectionProps {
    session: Session | null;
    onOpenBook: (book: Book, initialPage?: number) => void;
    bookSearch: string;
    onCollectionCount?: (count: number) => void;
}

export default function MyCollection({ session, onOpenBook, bookSearch, onCollectionCount }: MyCollectionProps) {
    const userId = session?.user?.id;
    const [books, setBooks] = useState<Book[]>([]);
    const [loading, setLoading] = useState(true);
    const [downloadingBookId, setDownloadingBookId] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [downloadedIds, setDownloadedIds] = useState<string[]>([]);
    const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
    const [onlineCoverErrors, setOnlineCoverErrors] = useState<Set<string>>(new Set());
    const [downloadError, setDownloadError] = useState<string | null>(null);
    const [isOffline, setIsOffline] = useState(!navigator.onLine);

    useEffect(() => {
        if (!isOffline) setOnlineCoverErrors(new Set());
    }, [isOffline]);

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
        if (!userId) return;
        listDownloadedBookIds(userId)
            .then(setDownloadedIds)
            .catch((e: unknown) => console.error(e));
        fetchCollection();
    }, [userId, isOffline]);

    useEffect(() => {
        if (!userId) {
            setCoverUrls(prev => {
                Object.values(prev).forEach(url => URL.revokeObjectURL(url));
                return {};
            });
            return;
        }
        let cancelled = false;
        const newUrls: Record<string, string> = {};

        (async () => {
            for (const book of books) {
                if (downloadedIds.includes(book.id)) {
                    const blob = await getBookCoverBlob(userId, book.id);
                    if (cancelled) return;
                    if (blob) {
                        newUrls[book.id] = URL.createObjectURL(blob);
                    }
                }
            }
            if (cancelled) {
                Object.values(newUrls).forEach(url => URL.revokeObjectURL(url));
                return;
            }
            setCoverUrls(prev => {
                const staleIds = Object.keys(prev).filter(id => !(id in newUrls));
                staleIds.forEach(id => URL.revokeObjectURL(prev[id]));
                return newUrls;
            });
        })();

        return () => {
            cancelled = true;
        };
    }, [userId, books, downloadedIds]);

    async function fetchCollection() {
        if (!session?.user?.id) return;
        const uid = session.user.id;
        setLoading(true);

        const offline = isOffline || session.access_token?.startsWith("offline_mock_access_token");

        if (offline) {
            const cachedBooks = getCachedOwnedBooks(uid);
            setBooks(cachedBooks);
            setLoading(false);
            return;
        }

        try {
            // Get book_access rows for this student
            const { data: accessRows, error: accessError } = await supabase
                .from("book_access")
                .select("book_id")
                .eq("user_id", uid);

            if (accessError) throw accessError;

            if (!accessRows || accessRows.length === 0) {
                setBooks([]);
                cacheOwnedBooks(uid, []);
                setLoading(false);
                return;
            }

            const bookIds = accessRows.map(row => row.book_id);

            // Fetch book details for those book IDs
            const { data: bookDetails, error: booksError } = await supabase
                .from("books")
                .select("*")
                .in("id", bookIds);

            if (booksError) throw booksError;

            const fetchedBooks = bookDetails || [];
            setBooks(fetchedBooks);
            // Cache owned books list for offline use
            cacheOwnedBooks(uid, fetchedBooks);
        } catch (err: unknown) {
            console.error("Error fetching collection:", err instanceof Error ? err.message : "Unknown error");
            // Fallback to cache on error
            const cachedBooks = getCachedOwnedBooks(uid);
            setBooks(cachedBooks);
        } finally {
            setLoading(false);
        }
    }

    const refreshDownloadedIds = async () => {
        if (!userId) return;
        const ids = await listDownloadedBookIds(userId);
        setDownloadedIds(ids);
    };

    const handleDownload = async (book: Book) => {
        if (downloadingBookId || !userId) return;

        const storagePath = getBookFilePath(book);
        if (!storagePath) {
            showToast("This book does not have a PDF file yet. Ask the publisher to upload one.", "warning");
            return;
        }

        setDownloadError(null);
        setDownloadingBookId(book.id);
        setDownloadProgress(0);

        try {
            await downloadBookFile(userId, book.id, storagePath, book.gdrive_url, setDownloadProgress);
            if (book.cover_url) {
                await downloadBookCover(userId, book.id, book.cover_url);
            }
            await refreshDownloadedIds();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Download failed.";
            setDownloadError(message);
            showToast(`Could not download "${book.title || "book"}": ${message}`, "error");
        } finally {
            setDownloadingBookId(null);
        }
    };

    const filteredBooks = books.filter(book =>
        book.title.toLowerCase().includes(bookSearch.toLowerCase()) ||
        (book.author && book.author.toLowerCase().includes(bookSearch.toLowerCase()))
    );

    useEffect(() => {
        onCollectionCount?.(filteredBooks.length);
    }, [filteredBooks.length, onCollectionCount]);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "25px" }}>
            
            {/* Collection Catalog */}
            <div>
                {downloadError && (
                    <p style={{ textAlign: "center", color: "#c62828", padding: "10px", backgroundColor: "#ffebee", borderRadius: "8px", marginBottom: "15px" }}>
                        {downloadError}
                    </p>
                )}
                {loading ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px", flexDirection: "column", gap: "12px" }}>
                        <div style={{ width: "36px", height: "36px", border: "3px solid #e0e0e0", borderTop: "3px solid #396cd8", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                        <p style={{ color: "#888", fontSize: "0.9rem" }}>Loading your personal collection...</p>
                    </div>
                ) : filteredBooks.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "40px 20px", color: "#666" }}>
                        <p style={{ margin: "0 0 10px 0", fontSize: "1.1rem", fontWeight: "600" }}>Your library is empty.</p>
                        <p style={{ margin: "0 0 20px 0", fontSize: "0.9rem" }}>You can redeem your first digital book by entering a PIN in the "Buy Book" tab.</p>
                    </div>
                ) : (
                    <>
                        <div className="books-grid">
                            {filteredBooks.map(book => {
                                const isDownloaded = downloadedIds.includes(book.id);
                                const isDownloading = downloadingBookId === book.id;
                                const hasPdfFile = Boolean(getBookFilePath(book));

                                return (
                                    <div key={book.id} className="book-card">
                                        <div className="book-card-cover">
                                            {isDownloaded ? (
                                                <img
                                                    key={`${book.id}-local`}
                                                    src={coverUrls[book.id] || "/logo.png"}
                                                    alt={book.title}
                                                    loading="lazy"
                                                    className="book-cover-img"
                                                />
                                            ) : isOffline ? (
                                                <div className="book-cover-offline">
                                                    <img src="/logo.png" alt="" className="book-cover-logo" />
                                                    <span className="book-cover-offline-text">You Are In Offline Mode</span>
                                                </div>
                                            ) : onlineCoverErrors.has(book.id) || !book.cover_url ? (
                                                <div className="book-cover-offline">
                                                    <img src="/logo.png" alt="" className="book-cover-logo" />
                                                </div>
                                            ) : (
                                                <img
                                                    key={`${book.id}-remote`}
                                                    src={book.cover_url}
                                                    alt={book.title}
                                                    loading="lazy"
                                                    className="book-cover-img"
                                                    onError={() => setOnlineCoverErrors(prev => new Set(prev).add(book.id))}
                                                />
                                            )}
                                            {isDownloaded && (
                                                <div className="book-card-badge" style={{ backgroundColor: "#2e7d32" }}>
                                                    Read Offline ✓
                                                </div>
                                            )}
                                        </div>
                                        <div className="book-card-details">
                                            <div>
                                                <h4 className="book-card-title" title={book.title}>{book.title}</h4>
                                                <p className="book-card-author">{book.author || "Unknown Author"}</p>
                                            </div>
                                            
                                            <div style={{ marginTop: "15px" }}>
                                                {isDownloading ? (
                                                    <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                                                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#666", fontWeight: "600" }}>
                                                            <span>Downloading...</span>
                                                            <span>{downloadProgress}%</span>
                                                        </div>
                                                        <div style={{ width: "100%", height: "6px", backgroundColor: "#eee", borderRadius: "3px", overflow: "hidden" }}>
                                                            <div style={{ width: `${downloadProgress}%`, height: "100%", backgroundColor: "#396cd8", transition: "width 0.1s ease" }}></div>
                                                        </div>
                                                    </div>
                                                ) : isDownloaded ? (
                                                    <div style={{ display: "flex", gap: "6px" }}>
                                                        <button 
                                                            className="btn btn-primary" 
                                                            style={{ 
                                                                flex: 1,
                                                                backgroundColor: "#2e7d32", 
                                                                color: "white", 
                                                                border: "none",
                                                                display: "flex",
                                                                alignItems: "center",
                                                                justifyContent: "center",
                                                                gap: "8px"
                                                            }}
                                                            onClick={() => onOpenBook(book)}
                                                        >
                                                            <BookOpen size={16} /> Read
                                                        </button>
                                                        <button 
                                                            style={{ 
                                                                padding: "8px 12px",
                                                                backgroundColor: "#dc3545", 
                                                                color: "white", 
                                                                border: "none",
                                                                borderRadius: "6px",
                                                                cursor: "pointer",
                                                                fontSize: "0.8rem",
                                                                whiteSpace: "nowrap"
                                                            }}
                                                            onClick={async () => {
                                                                if (userId) await removeBookDownload(userId, book.id);
                                                                await refreshDownloadedIds();
                                                            }}
                                                            title="Remove downloaded copy"
                                                            aria-label="Remove download"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button 
                                                        className="btn btn-primary" 
                                                        style={{ 
                                                            width: "100%", 
                                                            backgroundColor: (hasPdfFile && !isOffline) ? "#396cd8" : "#888", 
                                                            color: "white", 
                                                            border: "none",
                                                            display: "flex",
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            gap: "8px",
                                                            cursor: (hasPdfFile && !isOffline) ? "pointer" : "not-allowed",
                                                        }}
                                                        disabled={!hasPdfFile || isOffline}
                                                        title={isOffline ? "Internet required to download books" : hasPdfFile ? "Download PDF for offline reading" : "No PDF uploaded for this book"}
                                                        onClick={() => handleDownload(book)}
                                                    >
                                                        <Download size={16} /> {isOffline ? "Download (Online Only)" : hasPdfFile ? "Download Book" : "PDF Not Available"}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

        </div>
    );
}
