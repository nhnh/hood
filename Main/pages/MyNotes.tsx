import { useState, useEffect, useMemo } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import {
    NotebookPen,
    Trash2,
    ChevronLeft,
    ChevronRight,
    X,
    Edit,
    Save,
    FileText,
    BookOpen,
} from "lucide-react";
import { loadNotes, saveNotes } from "../lib/offlineNotes";
import { loadStandaloneNotes, saveStandaloneNotes } from "../lib/offlineStandaloneNotes";
import { cacheOwnedBooks, getCachedOwnedBooks } from "../lib/offlineAuth";
import { printNotesAsPdf } from "../lib/printNotes";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { Book, StandaloneNote, StandaloneNoteSection } from "../types";
import SimpleRichEditor from "../components/SimpleRichEditor";

interface MyNotesProps {
    session: Session | null;
    onOpenBook: (book: Book, initialPage?: number) => void;
    noteSearch?: string;
    setNoteSearch?: (v: string) => void;
    noteAddSignal?: number;
    setNoteAddSignal?: (v: number | ((prev: number) => number)) => void;
    setNoteViewTitle?: (v: string | null) => void;
    setNoteViewExport?: (v: (() => void) | null) => void;
    setNoteViewAddSection?: (v: (() => void) | null) => void;
    onNoteCountChange?: (count: number) => void;
    activeTab: string;
    setActiveTab: (tab: "all" | "book" | "side") => void;
    onTabCountsChange?: (counts: { all: number; book: number; side: number }) => void;
}

interface BookNoteEntry {
    id: string;
    page: number;
    text: string;
    createdAt: number;
    title?: string;
    bookId: string;
    bookTitle: string;
}

interface BookNotesMap {
    [bookId: string]: BookNoteEntry[];
}

interface ReadingNote {
    type: "book" | "side";
    id: string;
    title: string;
    text: string;
    createdAt: number;
    page?: number;
    bookId?: string;
    bookTitle?: string;
    sections?: StandaloneNoteSection[];
}

interface GroupedRow {
    key: string;
    kind: "book" | "side";
    title: string;
    count: number;
    bookId?: string;
    note?: StandaloneNote;
}

function stripHtmlText(html: string): string {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
}

function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function MyNotes({ session, onOpenBook, noteSearch, noteAddSignal, setNoteAddSignal, setNoteViewTitle, setNoteViewExport, setNoteViewAddSection, onNoteCountChange, activeTab, onTabCountsChange }: MyNotesProps) {
    const userId = session?.user?.id;
    const [standaloneNotes, setStandaloneNotes] = useState<StandaloneNote[]>([]);
    const [books, setBooks] = useState<Book[]>([]);
    const [bookNotesMap, setBookNotesMap] = useState<BookNotesMap>({});
    const [loading, setLoading] = useState(true);
    const [bookNotesLoading, setBookNotesLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);

    // Individual Note Reader (single note)
    const [readingNote, setReadingNote] = useState<ReadingNote | null>(null);

    // Create/Edit modal
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
    const [editingBookNote, setEditingBookNote] = useState<BookNoteEntry | null>(null);
    const [modalTitle, setModalTitle] = useState("");
    const [modalText, setModalText] = useState("");
    const [isCreatingTitleOnly, setIsCreatingTitleOnly] = useState(false);
    const [editingTitle, setEditingTitle] = useState(false);
    const [editingSectionTitle, setEditingSectionTitle] = useState(false);

    // Section CRUD within side note reader
    const [isSectionModalOpen, setIsSectionModalOpen] = useState(false);
    const [editingSection, setEditingSection] = useState<StandaloneNoteSection | null>(null);
    const [sectionTitle, setSectionTitle] = useState("");
    const [sectionText, setSectionText] = useState("");

    const [isOffline, setIsOffline] = useState(!navigator.onLine);

    useEffect(() => {
        const on = () => setIsOffline(false);
        const off = () => setIsOffline(true);
        window.addEventListener("online", on);
        window.addEventListener("offline", off);
        return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
    }, []);

    useEffect(() => {
        if (!userId) return;
        loadStandaloneNotes(userId).then(setStandaloneNotes).catch(console.error);
        fetchBooks();
        return () => { setNoteViewTitle?.(null); setNoteViewExport?.(null); setNoteViewAddSection?.(null); };
    }, [userId]);

    async function fetchBooks() {
        if (!session?.user?.id) return;
        const uid = session.user.id;
        setLoading(true);
        const offline = isOffline || session.access_token?.startsWith("offline_mock_access_token");
        if (offline) {
            const cached = getCachedOwnedBooks(uid);
            setBooks(cached);
            setLoading(false);
            if (cached.length > 0) await loadAllBookNotes(cached);
            return;
        }
        try {
            const { data: accessRows } = await supabase
                .from("book_access")
                .select("book_id")
                .eq("user_id", uid);
            if (!accessRows || accessRows.length === 0) { setLoading(false); return; }
            const bookIds = accessRows.map(r => r.book_id);
            const { data: bookDetails } = await supabase
                .from("books")
                .select("*")
                .in("id", bookIds);
            const fetched = bookDetails || [];
            setBooks(fetched);
            cacheOwnedBooks(uid, fetched);
            if (fetched.length > 0) await loadAllBookNotes(fetched);
        } catch {
            const cached = getCachedOwnedBooks(uid);
            setBooks(cached);
            if (cached.length > 0) await loadAllBookNotes(cached);
        } finally {
            setLoading(false);
        }
    }

    async function loadAllBookNotes(bookList: Book[]) {
        if (!userId) {
            setBookNotesMap({});
            setBookNotesLoading(false);
            return;
        }
        setBookNotesLoading(true);
        const map: BookNotesMap = {};
        const results = await Promise.allSettled(
            bookList.map(async (b) => {
                const notes = await loadNotes(userId, b.id);
                return { bookId: b.id, bookTitle: b.title, notes };
            })
        );
        for (const result of results) {
            if (result.status === "fulfilled") {
                const { bookId, bookTitle, notes } = result.value;
                if (notes.length > 0) {
                    map[bookId] = notes.map(n => ({ ...n, bookId, bookTitle }));
                }
            }
        }
        setBookNotesMap(map);
        setBookNotesLoading(false);
    }

    // ---- Derived grouped data ----

    const groupedRows = useMemo((): GroupedRow[] => {
        const rows: GroupedRow[] = [];

        if (activeTab === "book" || activeTab === "all") {
            for (const book of books) {
                const entries = bookNotesMap[book.id];
                if (!entries || entries.length === 0) continue;
                rows.push({
                    key: `book-${book.id}`,
                    kind: "book",
                    title: book.title,
                    count: entries.length,
                    bookId: book.id,
                });
            }
        }

        if (activeTab === "side" || activeTab === "all") {
            for (const note of standaloneNotes) {
                rows.push({
                    key: `side-${note.id}`,
                    kind: "side",
                    title: note.title,
                    count: 1,
                    note,
                });
            }
        }

        const st = noteSearch ?? "";
        if (!st.trim()) return rows;
        const q = st.toLowerCase();
        return rows.filter(r => r.title.toLowerCase().includes(q));
    }, [activeTab, books, bookNotesMap, standaloneNotes, noteSearch ?? ""]);

    const tabCounts = useMemo(() => {
        const bookGroups = Object.keys(bookNotesMap).length;
        return {
            all: bookGroups + standaloneNotes.length,
            book: bookGroups,
            side: standaloneNotes.length,
        };
    }, [bookNotesMap, standaloneNotes.length]);

    useEffect(() => {
        onNoteCountChange?.(tabCounts.all);
        onTabCountsChange?.(tabCounts);
    }, [tabCounts, onNoteCountChange, onTabCountsChange]);

    const ITEMS_PER_PAGE = 15;
    const totalPages = Math.ceil(groupedRows.length / ITEMS_PER_PAGE);
    const paginatedRows = groupedRows.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

    useEffect(() => {
        setCurrentPage(1);
    }, [noteSearch ?? "", activeTab]);

    useEffect(() => {
        if (noteAddSignal && noteAddSignal > 0) {
            resetForm();
            setIsCreatingTitleOnly(true);
            setIsModalOpen(true);
            setNoteAddSignal?.(0);
        }
    }, [noteAddSignal, setNoteAddSignal]);

    // ---- CRUD ----

    function resetForm() {
        setEditingNoteId(null);
        setEditingBookNote(null);
        setModalTitle("");
        setModalText("");
        setIsCreatingTitleOnly(false);
        setEditingTitle(false);
    }

    function openEditBookNote(note: BookNoteEntry) {
        setEditingBookNote(note);
        setModalTitle(note.title || "");
        setModalText(note.text);
        setIsModalOpen(true);
    }

    async function deleteBookNote(note: BookNoteEntry) {
        if (!window.confirm("Delete this note?")) return;
        if (!userId) return;
        const bookId = note.bookId;
        const updated = (bookNotesMap[bookId] || []).filter(n => n.id !== note.id);
        if (updated.length === 0) {
            const newMap = { ...bookNotesMap };
            delete newMap[bookId];
            setBookNotesMap(newMap);
        } else {
            setBookNotesMap(prev => ({ ...prev, [bookId]: updated }));
        }
        await saveNotes(userId, bookId, updated);
        if (readingNote && readingNote.id === note.id) {
            setReadingNote(null);
        }
    }

    async function handleDeleteGroup(row: GroupedRow) {
        if (!userId) return;
        if (row.kind === "book" && row.bookId) {
            const ok = await confirm(`Delete all notes for "${row.title}"?`, { title: "Delete Notes", kind: "warning" });
            if (!ok) return;
            await saveNotes(userId, row.bookId, []);
            setBookNotesMap(prev => {
                const next = { ...prev };
                delete next[row.bookId!];
                return next;
            });
            if (readingBook?.bookId === row.bookId) setReadingBook(null);
        } else if (row.kind === "side" && row.note) {
            const ok = await confirm(`Delete "${row.title}"?`, { title: "Delete Note", kind: "warning" });
            if (!ok) return;
            const updated = standaloneNotes.filter(n => n.id !== row.note!.id);
            setStandaloneNotes(updated);
            await saveStandaloneNotes(userId, updated);
            if (readingNote?.id === row.note!.id) setReadingNote(null);
        }
    }

    function openSideNoteReader(note: StandaloneNote) {
        setReadingNote({
            type: "side",
            id: note.id,
            title: note.title,
            text: note.text,
            createdAt: note.createdAt,
            sections: note.sections ?? [],
        });
        setNoteViewTitle?.(note.title);
        setNoteViewAddSection?.(() => () => openAddSectionModal());
        setNoteViewExport?.(() => () => {
            const sections2 = note.sections ?? [];
            const items = sections2.length > 0
                ? sections2.map(s => ({
                    heading: s.title || "Section",
                    date: formatDate(s.createdAt),
                    content: s.text,
                }))
                : [{
                    heading: "",
                    date: formatDate(note.createdAt),
                    content: note.text || "",
                }];
            printNotesAsPdf([{
                title: note.title || "Side Notes",
                items,
            }], note.title || "Side Notes");
        });
    }

    async function saveModalNote() {
        if (!userId) return;

        if (editingBookNote) {
            const updated = (bookNotesMap[readingBook?.bookId || editingBookNote.bookId] || []).map(n =>
                n.id === editingBookNote.id
                    ? { ...n, title: modalTitle.trim() || undefined, text: modalText }
                    : n
            );
            const bookId = readingBook?.bookId || editingBookNote.bookId;
            setBookNotesMap(prev => ({ ...prev, [bookId]: updated }));
            await saveNotes(userId, bookId, updated);
            setIsModalOpen(false);
            resetForm();
            return;
        }

        if (isCreatingTitleOnly) {
            if (!modalTitle.trim()) return;
            let updated: StandaloneNote[];
            if (editingNoteId) {
                updated = standaloneNotes.map(n =>
                    n.id === editingNoteId
                        ? { ...n, title: modalTitle.trim(), updatedAt: Date.now() }
                        : n
                );
                setStandaloneNotes(updated);
                if (readingNote && readingNote.type === "side") {
                    const saved = updated.find(n => n.id === editingNoteId);
                    if (saved) { setReadingNote({ ...readingNote, title: saved.title }); setNoteViewTitle?.(saved.title); }
                }
            } else {
                updated = [
                    ...standaloneNotes,
                    { id: generateId(), title: modalTitle.trim(), text: "", sections: [], createdAt: Date.now(), updatedAt: Date.now() },
                ];
                setStandaloneNotes(updated);
            }
            await saveStandaloneNotes(userId, updated);
            setIsModalOpen(false);
            resetForm();
            if (!editingNoteId) {
                const newNote = updated[updated.length - 1];
                openSideNoteReader(newNote);
            }
            return;
        }

        if (!stripHtmlText(modalText).trim() && !modalTitle.trim()) return;

        let updated: StandaloneNote[];
        if (editingNoteId) {
            updated = standaloneNotes.map(n =>
                n.id === editingNoteId
                    ? { ...n, title: modalTitle.trim() || "Untitled", text: modalText, updatedAt: Date.now() }
                    : n
            );
        } else {
            updated = [
                ...standaloneNotes,
                { id: generateId(), title: modalTitle.trim() || "Untitled", text: modalText, createdAt: Date.now(), updatedAt: Date.now() },
            ];
        }
        setStandaloneNotes(updated);
        await saveStandaloneNotes(userId, updated);
        if (readingNote && readingNote.type === "side") {
            const saved = updated.find(n => n.id === (editingNoteId || generateId()));
            if (saved) { setReadingNote(prev => prev ? { ...prev, title: saved.title, text: saved.text } : prev); setNoteViewTitle?.(saved.title); }
        }
        setIsModalOpen(false);
        resetForm();
    }


    // ---- Section CRUD (inside side note reader) ----

    function syncReadingNoteSections(sections: StandaloneNoteSection[]) {
        if (!readingNote || readingNote.type !== "side" || !userId) return;
        const updatedNotes = standaloneNotes.map(n =>
            n.id === readingNote.id ? { ...n, sections, updatedAt: Date.now() } : n
        );
        setStandaloneNotes(updatedNotes);
        setReadingNote({ ...readingNote, sections });
        saveStandaloneNotes(userId, updatedNotes);
    }

    function resetSectionForm() {
        setEditingSection(null);
        setSectionTitle("");
        setSectionText("");
        setEditingSectionTitle(false);
    }

    function openAddSectionModal() {
        resetSectionForm();
        setIsSectionModalOpen(true);
    }

    function openEditSectionModal(section: StandaloneNoteSection) {
        setEditingSection(section);
        setSectionTitle(section.title);
        setSectionText(section.text);
        setIsSectionModalOpen(true);
    }

    function saveSection() {
        if (!sectionTitle.trim() && !stripHtmlText(sectionText).trim()) return;
        const currentSections = readingNote?.sections ?? [];
        let updated: StandaloneNoteSection[];
        if (editingSection) {
            updated = currentSections.map(s =>
                s.id === editingSection.id
                    ? { ...s, title: sectionTitle.trim(), text: sectionText, updatedAt: Date.now() }
                    : s
            );
        } else {
            updated = [
                ...currentSections,
                { id: generateId(), title: sectionTitle.trim(), text: sectionText, createdAt: Date.now(), updatedAt: Date.now() },
            ];
        }
        syncReadingNoteSections(updated);
        setIsSectionModalOpen(false);
        resetSectionForm();
    }

    function deleteSection(sectionId: string) {
        if (!window.confirm("Delete this section?")) return;
        const currentSections = readingNote?.sections ?? [];
        syncReadingNoteSections(currentSections.filter(s => s.id !== sectionId));
    }

    // Aggregated book notes view (full page, same pattern as Note Reader)
    const [readingBook, setReadingBook] = useState<{ bookId: string; bookTitle: string } | null>(null);

    // ========================
    // INDIVIDUAL NOTE READER
    // ========================

    if (readingNote) {
        return (
            <div>
                    {readingNote.type === "side" ? (
                        <div>
                            {(() => {
                                    const allSections = readingNote.sections ?? [];
                                    const q = (noteSearch ?? "").toLowerCase().trim();
                                    const filtered = q
                                        ? allSections.filter(s => s.title.toLowerCase().includes(q) || stripHtmlText(s.text).toLowerCase().includes(q))
                                        : allSections;
                                    if (allSections.length === 0) {
                                        return (
                                            <div style={{ width: '100%', minHeight: '120px', backgroundColor: '#fafafa', border: '1px solid #eee', borderRadius: '8px', padding: '24px', boxSizing: 'border-box', color: '#888', lineHeight: '1.8', fontSize: '0.95rem', textAlign: 'center' }}>
                                                <em>No sections yet. Click "Add Section" to add content.</em>
                                            </div>
                                        );
                                    }
                                    if (filtered.length === 0) {
                                        return (
                                            <div style={{ width: '100%', minHeight: '120px', backgroundColor: '#fafafa', border: '1px solid #eee', borderRadius: '8px', padding: '24px', boxSizing: 'border-box', color: '#888', lineHeight: '1.8', fontSize: '0.95rem', textAlign: 'center' }}>
                                                <em>No sections match your search.</em>
                                            </div>
                                        );
                                    }
                                    return (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                            {filtered.map((section) => (
                                            <div key={section.id} style={{ border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: '#f8f9fa', borderBottom: '1px solid #eee' }}>
                                                    <strong style={{ color: '#1e293b', fontWeight: 700, fontSize: '0.95rem' }}>
                                                        {section.title || <em style={{ color: '#aaa' }}>Untitled section</em>}
                                                    </strong>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <span style={{ fontSize: '0.8rem', color: '#888', whiteSpace: 'nowrap' }}>
                                                            {new Date(section.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}, {new Date(section.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                                                        </span>
                                                        <div style={{ display: 'flex', gap: '6px' }}>
                                                            <button className="btn btn-icon btn-edit" onClick={() => openEditSectionModal(section)} title="Edit section">
                                                                <Edit size={14} />
                                                            </button>
                                                            <button className="btn btn-icon btn-delete" onClick={() => deleteSection(section.id)} title="Delete section">
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div style={{ padding: '16px', fontSize: '0.9rem', color: '#333', lineHeight: '1.7', backgroundColor: '#fff' }}>
                                                    <div dangerouslySetInnerHTML={{ __html: section.text || "<em style='color:#aaa'>Empty section</em>" }} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    );
                                })()}
                            </div>
                        ) : (
                            <div style={{
                                width: '100%',
                                minHeight: '200px',
                                border: '1px solid #e0e0e0',
                                borderRadius: '8px',
                                overflow: 'hidden',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: '#f8f9fa', borderBottom: '1px solid #eee' }}>
                                    <strong style={{ color: '#1e293b', fontWeight: 700, fontSize: '0.95rem' }}>
                                        {readingNote.title || <em style={{ color: '#aaa' }}>Untitled</em>}
                                    </strong>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <span style={{ fontSize: '0.8rem', color: '#888', whiteSpace: 'nowrap' }}>
                                            {new Date(readingNote.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}, {new Date(readingNote.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                                        </span>
                                    </div>
                                </div>
                                <div style={{ padding: '16px', fontSize: '0.9rem', color: '#333', lineHeight: '1.7', backgroundColor: '#fff' }}>
                                    <div dangerouslySetInnerHTML={{ __html: readingNote.text || "<em style='color:#aaa'>Empty note</em>" }} />
                                </div>
                            </div>
                        )}

                        {readingNote.type === "book" && (
                            <div style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                <button className="btn btn-icon btn-delete" onClick={() => {
                                    const note = bookNotesMap[readingNote.bookId!]?.find(n => n.id === readingNote.id);
                                    if (note) deleteBookNote(note);
                                }} title="Delete note">
                                    <Trash2 size={16} />
                                </button>
                                <button className="btn btn-icon btn-edit" onClick={() => {
                                    const note = bookNotesMap[readingNote.bookId!]?.find(n => n.id === readingNote.id);
                                    if (note) openEditBookNote(note);
                                }} title="Edit note">
                                    <Edit size={16} />
                                </button>
                                <button className="btn btn-primary" onClick={() => {
                                    const book = books.find(b => b.id === readingNote.bookId);
                                    if (book) onOpenBook(book);
                                }}>
                                    <NotebookPen size={16} /> Open in Reader
                                </button>
                            </div>
                        )}

                {isModalOpen && (
                    <div className="modal-overlay">
                        {editingNoteId ? (
                            /* Edit mode: full layout */
                            <div className="modal-content" style={{ width: '80%', height: '80vh', display: 'flex', flexDirection: 'column', resize: 'both', overflow: 'hidden', padding: 0 }}>
                                <div className="modal-header" style={{ gap: '12px', marginBottom: 0, padding: '12px 20px 10px', borderBottom: 'none' }}>
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => setEditingTitle(true)}>
                                        <NotebookPen size={20} color="#396cd8" />
                                        {editingTitle ? (
                                            <input
                                                type="text"
                                                className="form-control"
                                                placeholder="Note title"
                                                value={modalTitle}
                                                onChange={e => setModalTitle(e.target.value)}
                                                onBlur={() => setEditingTitle(false)}
                                                onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                                                style={{ flex: 1, fontWeight: 600, fontSize: '1rem', padding: '6px 10px' }}
                                                autoFocus
                                            />
                                        ) : (
                                            <span style={{ flex: 1, fontWeight: 600, fontSize: '1rem', color: modalTitle ? '#000' : '#aaa', padding: '6px 10px', userSelect: 'none' }}>
                                                {modalTitle || 'Click to title'}
                                            </span>
                                        )}
                                    </div>
                                    <button className="close-btn" onClick={() => { setIsModalOpen(false); resetForm(); }}><X size={20} /></button>
                                </div>
                                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                    {!isCreatingTitleOnly && (
                                        <SimpleRichEditor
                                            value={modalText}
                                            onChange={setModalText}
                                            placeholder="Write your note..."
                                            fillHeight
                                        />
                                    )}
                                </div>
                                <div className="modal-footer" style={{ padding: '12px 20px 20px', textAlign: 'right' }}>
                                    <button type="button" className="btn btn-secondary" onClick={() => { setIsModalOpen(false); resetForm(); }} style={{ marginRight: '10px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}><X size={16} /> Cancel</button>
                                    <button type="button" className="btn btn-primary" onClick={saveModalNote} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                        <Save size={16} /> Update
                                    </button>
                                </div>
                            </div>
                        ) : (
                            /* Create mode: compact inline */
                            <div className="modal-content" style={{ width: '400px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <NotebookPen size={18} color="#396cd8" style={{ flexShrink: 0 }} />
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder="Note title"
                                    value={modalTitle}
                                    onChange={e => setModalTitle(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { saveModalNote(); } }}
                                    style={{ flex: 1, fontWeight: 600, fontSize: '0.95rem', padding: '8px 12px', height: '38px' }}
                                    autoFocus
                                />
                                <button type="button" className="btn btn-primary" onClick={saveModalNote} style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '6px', height: '38px' }}>
                                    <Save size={16} /> Save
                                </button>
                                <button className="close-btn" onClick={() => { setIsModalOpen(false); resetForm(); }} style={{ flexShrink: 0 }}><X size={18} /></button>
                            </div>
                        )}
                    </div>
                )}

                {isSectionModalOpen && (
                    <div className="modal-overlay">
                        <div className="modal-content" style={{ width: '80%', height: '80vh', display: 'flex', flexDirection: 'column', resize: 'both', overflow: 'hidden', padding: 0 }}>
                            <div className="modal-header" style={{ gap: '12px', marginBottom: 0, padding: '12px 20px 10px', borderBottom: 'none' }}>
                                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => setEditingSectionTitle(true)}>
                                    <FileText size={20} color="#396cd8" />
                                    {editingSectionTitle ? (
                                        <input
                                            type="text"
                                            className="form-control"
                                            placeholder="Section title"
                                            value={sectionTitle}
                                            onChange={e => setSectionTitle(e.target.value)}
                                            onBlur={() => setEditingSectionTitle(false)}
                                            onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                                            style={{ flex: 1, fontWeight: 600, fontSize: '1rem', padding: '6px 10px' }}
                                            autoFocus
                                        />
                                    ) : (
                                        <span style={{ flex: 1, fontWeight: 600, fontSize: '1rem', color: sectionTitle ? '#000' : '#aaa', padding: '6px 10px', userSelect: 'none' }}>
                                            {sectionTitle || 'Click to title'}
                                        </span>
                                    )}
                                </div>
                                <button className="close-btn" onClick={() => { setIsSectionModalOpen(false); resetSectionForm(); }}><X size={20} /></button>
                            </div>
                            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                <SimpleRichEditor
                                    value={sectionText}
                                    onChange={setSectionText}
                                    placeholder="Write section content..."
                                    fillHeight
                                />
                            </div>
                            <div className="modal-footer" style={{ padding: '12px 20px 20px', textAlign: 'right' }}>
                                <button type="button" className="btn btn-secondary" onClick={() => { setIsSectionModalOpen(false); resetSectionForm(); }} style={{ marginRight: '10px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}><X size={16} /> Cancel</button>
                                <button type="button" className="btn btn-primary" onClick={saveSection} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <Save size={16} /> {editingSection ? "Update" : "Add Section"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ==================================
    // AGGREGATED BOOK NOTES PAGE

    if (readingBook) {
        const entries = bookNotesMap[readingBook.bookId] || [];
        const sorted = [...entries].sort((a, b) => a.page - b.page);
        return (
            <div>
                    <div>
                        {(() => {
                            const q = (noteSearch ?? "").toLowerCase().trim();
                            const filtered = q
                                ? sorted.filter(n => (n.title || "").toLowerCase().includes(q) || stripHtmlText(n.text).toLowerCase().includes(q))
                                : sorted;
                            if (sorted.length === 0) {
                                return <p style={{ color: '#888', textAlign: 'center', padding: '20px' }}>No notes for this book.</p>;
                            }
                            if (filtered.length === 0) {
                                return <p style={{ color: '#888', textAlign: 'center', padding: '20px' }}>No notes match your search.</p>;
                            }
                            return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    {filtered.map((note) => {
                                const book = books.find(b => b.id === readingBook.bookId);
                                return (
                                <div key={note.id} style={{ border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: '#f8f9fa', borderBottom: '1px solid #eee' }}>
                                        <strong style={{ color: '#1e293b', fontWeight: 700, fontSize: '0.95rem' }}>
                                            {note.title || <em style={{ color: '#aaa' }}>Untitled</em>}
                                        </strong>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <button className="btn btn-icon" onClick={() => { if (book) onOpenBook(book, note.page); }} title="Open book at page {note.page}" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '6px', backgroundColor: '#e3f2fd', color: '#396cd8', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}>
                                                <BookOpen size={14} /> p.{note.page}
                                            </button>
                                            <span style={{ fontSize: '0.8rem', color: '#888', whiteSpace: 'nowrap' }}>
                                                {new Date(note.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}, {new Date(note.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                                            </span>
                                            <button className="btn btn-icon btn-edit" onClick={(e) => { e.stopPropagation(); openEditBookNote(note); }} title="Edit note">
                                                <Edit size={14} />
                                            </button>
                                            <button className="btn btn-icon btn-delete" onClick={(e) => { e.stopPropagation(); deleteBookNote(note); }} title="Delete note">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    <div style={{ padding: '16px', fontSize: '0.9rem', color: '#333', lineHeight: '1.7', backgroundColor: '#fff' }}>
                                        <div dangerouslySetInnerHTML={{ __html: note.text || "<em style='color:#aaa'>Empty note</em>" }} />
                                    </div>
                                </div>
                            );
                            })}
                            </div>
                            );
                        })()}
                    </div>

                {isModalOpen && (
                    <div className="modal-overlay">
                        <div className="modal-content" style={{ width: '80%', height: '80vh', display: 'flex', flexDirection: 'column', resize: 'both', overflow: 'hidden', padding: 0 }}>
                            <div className="modal-header" style={{ gap: '12px', marginBottom: 0, padding: '12px 20px 10px', borderBottom: 'none' }}>
                                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => setEditingTitle(true)}>
                                    <NotebookPen size={20} color="#396cd8" />
                                    {editingTitle ? (
                                        <input
                                            type="text"
                                            className="form-control"
                                            placeholder="Note title"
                                            value={modalTitle}
                                            onChange={e => setModalTitle(e.target.value)}
                                            onBlur={() => setEditingTitle(false)}
                                            onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                                            style={{ flex: 1, fontWeight: 600, fontSize: '1rem', padding: '6px 10px' }}
                                            autoFocus
                                        />
                                    ) : (
                                        <span style={{ flex: 1, fontWeight: 600, fontSize: '1rem', color: modalTitle ? '#000' : '#aaa', padding: '6px 10px', userSelect: 'none' }}>
                                            {modalTitle || 'Click to title'}
                                        </span>
                                    )}
                                </div>
                                <button className="close-btn" onClick={() => { setIsModalOpen(false); resetForm(); }}><X size={20} /></button>
                            </div>
                            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                {!isCreatingTitleOnly && (
                                    <SimpleRichEditor
                                        value={modalText}
                                        onChange={setModalText}
                                        placeholder="Write your note..."
                                        fillHeight
                                    />
                                )}
                            </div>
                            <div className="modal-footer" style={{ padding: '12px 20px 20px', textAlign: 'right' }}>
                                <button type="button" className="btn btn-secondary" onClick={() => { setIsModalOpen(false); resetForm(); }} style={{ marginRight: '10px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}><X size={16} /> Cancel</button>
                                <button type="button" className="btn btn-primary" onClick={saveModalNote} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <Save size={16} /> {editingBookNote || editingNoteId ? "Update" : "Save"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // =====================
    // LIST VIEW (default)
    // =====================

    if (loading) return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px", flexDirection: "column", gap: "12px" }}>
            <div style={{ width: "36px", height: "36px", border: "3px solid #e0e0e0", borderTop: "3px solid #396cd8", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <p style={{ color: "#888", fontSize: "0.9rem" }}>Loading...</p>
        </div>
    );

    return (
        <div>
            <div>
                {bookNotesLoading ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px", flexDirection: "column", gap: "12px" }}>
                        <div style={{ width: "36px", height: "36px", border: "3px solid #e0e0e0", borderTop: "3px solid #396cd8", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                        <p style={{ color: "#888", fontSize: "0.9rem" }}>Loading book notes...</p>
                    </div>
                ) : (
                        <div className="table-responsive" style={{ width: '100%' }}>
                            <table className="table" style={{ width: '100%' }}>
                                    <thead>
                                        <tr>
                                            <th style={{ textAlign: 'center', width: '80px' }}>Type</th>
                                            <th style={{ paddingLeft: '16px' }}>Title</th>
                                            <th style={{ textAlign: 'center', width: '70px' }}>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="beautified-tbody">
                                        {paginatedRows.length === 0 ? (
                                            <tr>
                                                <td colSpan={2} style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                                                    {(noteSearch ?? "") ? "No results match your search." : "No notes yet. Click + on Side Notes to create your first one."}
                                                </td>
                                            </tr>
                                        ) : paginatedRows.map(row => {
                                            const isBook = row.kind === "book";
                                            return (
                                                <tr key={row.key}>
                                                    <td style={{ textAlign: 'center', verticalAlign: 'middle', width: '80px' }}>
                                                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                                                            <span style={{
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                width: '26px',
                                                                height: '26px',
                                                                borderRadius: '50%',
                                                                fontSize: '0.75rem',
                                                                fontWeight: 800,
                                                                backgroundColor: isBook ? '#e3f2fd' : '#e8f5e9',
                                                                color: isBook ? '#1565c0' : '#2e7d32',
                                                            }} title={isBook ? 'Book Notes' : 'Side Note'}>
                                                                {isBook ? 'B' : 'S'}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td style={{ paddingLeft: '16px', cursor: 'pointer' }} onClick={() => {
                                                        if (isBook && row.bookId) {
                                                            setReadingBook({ bookId: row.bookId, bookTitle: row.title });
                                                            setNoteViewTitle?.(`Notes For ${row.title}`);
                                                            setNoteViewAddSection?.(null);
                                                            setNoteViewExport?.(() => () => {
                                                                const entries2 = bookNotesMap[row.bookId!];
                                                                if (!entries2 || entries2.length === 0) return;
                                                                printNotesAsPdf([{
                                                                    title: row.title,
                                                                    items: [...entries2].sort((a, b) => a.page - b.page).map(n => ({
                                                                        heading: n.title || `Page ${n.page}`,
                                                                        date: formatDate(n.createdAt),
                                                                        content: n.text,
                                                                    })),
                                                                }], row.title);
                                                            });
                                                        } else if (row.note) openSideNoteReader(row.note);
                                                    }}>
                                                        <div style={{ fontWeight: 600, color: '#111', fontSize: '1.1rem' }}>
                                                            {row.title}
                                                        </div>
                                                        <div style={{ fontSize: '0.85rem', color: '#888' }}>
                                                            {isBook ? `${row.count} note${row.count === 1 ? '' : 's'}` : `${(row.note?.sections ?? []).length} section${(row.note?.sections ?? []).length === 1 ? '' : 's'}`}
                                                        </div>
                                                    </td>
                                                    <td style={{ textAlign: 'center', verticalAlign: 'middle', width: '70px' }}>
                                                        <button
                                                            className="btn btn-icon btn-delete"
                                                            onClick={(e) => { e.stopPropagation(); handleDeleteGroup(row); }}
                                                            title={isBook ? "Delete all notes for this book" : "Delete this note"}
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                            </table>

                            {totalPages > 1 && (
                                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', marginTop: '20px', padding: '10px' }}>
                                    <button className="btn btn-secondary btn-sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                                        <ChevronLeft size={16} /> Previous
                                    </button>
                                    <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Page {currentPage} of {totalPages}</span>
                                    <button className="btn btn-secondary btn-sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>
                                        Next <ChevronRight size={16} />
                                    </button>
                                </div>
                            )}
                            </div>
                        )}

                    </div>

                {isModalOpen && (
                    <div className="modal-overlay">
                        {editingBookNote ? (
                            /* Book note edit: full layout */
                            <div className="modal-content" style={{ width: '80%', height: '80vh', display: 'flex', flexDirection: 'column', resize: 'both', overflow: 'hidden', padding: 0 }}>
                                <div className="modal-header" style={{ gap: '12px', marginBottom: 0, padding: '12px 20px 10px', borderBottom: 'none' }}>
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => setEditingTitle(true)}>
                                        <NotebookPen size={20} color="#396cd8" />
                                        {editingTitle ? (
                                            <input
                                                type="text"
                                                className="form-control"
                                                placeholder="Note title"
                                                value={modalTitle}
                                                onChange={e => setModalTitle(e.target.value)}
                                                onBlur={() => setEditingTitle(false)}
                                                onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                                                style={{ flex: 1, fontWeight: 600, fontSize: '1rem', padding: '6px 10px' }}
                                                autoFocus
                                            />
                                        ) : (
                                            <span style={{ flex: 1, fontWeight: 600, fontSize: '1rem', color: modalTitle ? '#000' : '#aaa', padding: '6px 10px', userSelect: 'none' }}>
                                                {modalTitle || 'Click to title'}
                                            </span>
                                        )}
                                    </div>
                                    <button className="close-btn" onClick={() => { setIsModalOpen(false); resetForm(); }}><X size={20} /></button>
                                </div>
                                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                    {!isCreatingTitleOnly && (
                                        <SimpleRichEditor
                                            value={modalText}
                                            onChange={setModalText}
                                            placeholder="Write your note..."
                                            fillHeight
                                        />
                                    )}
                                </div>
                                <div className="modal-footer" style={{ padding: '12px 20px 20px', textAlign: 'right' }}>
                                    <button type="button" className="btn btn-secondary" onClick={() => { setIsModalOpen(false); resetForm(); }} style={{ marginRight: '10px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}><X size={16} /> Cancel</button>
                                    <button type="button" className="btn btn-primary" onClick={saveModalNote} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                        <Save size={16} /> Update
                                    </button>
                                </div>
                            </div>
                        ) : (
                            /* Create mode: compact inline */
                            <div className="modal-content" style={{ width: '400px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <NotebookPen size={18} color="#396cd8" style={{ flexShrink: 0 }} />
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder="Note title"
                                    value={modalTitle}
                                    onChange={e => setModalTitle(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { saveModalNote(); } }}
                                    style={{ flex: 1, fontWeight: 600, fontSize: '0.95rem', padding: '8px 12px', height: '38px' }}
                                    autoFocus
                                />
                                <button type="button" className="btn btn-primary" onClick={saveModalNote} style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '6px', height: '38px' }}>
                                    <Save size={16} /> Save
                                </button>
                                <button className="close-btn" onClick={() => { setIsModalOpen(false); resetForm(); }} style={{ flexShrink: 0 }}><X size={18} /></button>
                            </div>
                        )}
                    </div>
                )}
            </div>
    );
}
