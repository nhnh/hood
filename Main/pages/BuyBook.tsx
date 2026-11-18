import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabaseClient";
import { Session } from "@supabase/supabase-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
    ShoppingBag,
    CreditCard,
    ArrowRight,
    ShieldCheck,
    X,
    BookOpen,
    UserCircle,
    ExternalLink,
} from "lucide-react";
import {
    createToyyibpayBill,
    getToyyibpayBillTransactions,
    sanitizeToyyibpayText,
} from "../lib/toyyibpay";
import { formatErrorMessage } from "../lib/errors";
import { showToast } from "../lib/toast";
import type { Book } from "../types";

interface BuyBookProps {
    session: Session | null;
    onOpenBook: (book: Book, initialPage?: number) => void;
    bookSearch?: string;
    onBuyBookCount?: (count: number) => void;
    paymentDeepLink: string | null;
    onClearPaymentDeepLink: () => void;
}

interface PendingPayment {
    billCode: string;
    bookId: string;
    sectionId: string | null;
    price: number;
}

const RETURN_URL =
    import.meta.env.VITE_TOYYIBPAY_RETURN_URL || "cloudshelf://payment-return";

export default function BuyBook({ session, onOpenBook, bookSearch, onBuyBookCount, paymentDeepLink, onClearPaymentDeepLink }: BuyBookProps) {
    const [books, setBooks] = useState<Book[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);

    const [sections, setSections] = useState<{ id: string; name: string; semester: string }[]>([]);
    const [sectionsLoading, setSectionsLoading] = useState(false);
    const [sectionsError, setSectionsError] = useState<string | null>(null);
    const [selectedBook, setSelectedBook] = useState<Book | null>(null);
    const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
    const [buyerName, setBuyerName] = useState("");
    const [buyerEmail, setBuyerEmail] = useState("");
    const [buyerPhone, setBuyerPhone] = useState("");
    const [selectedSectionId, setSelectedSectionId] = useState("");
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
    const pendingPaymentRef = useRef<PendingPayment | null>(null);
    const selectedBookRef = useRef<Book | null>(null);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isGrantingRef = useRef(false);
    const [isOffline, setIsOffline] = useState(!navigator.onLine);

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
        if (!isOffline) {
            fetchCatalog();
        }
        if (session?.user) {
            setBuyerEmail(session.user.email || "");
            setBuyerName(session.user.user_metadata?.full_name || "");
        }
    }, [session, isOffline]);

    useEffect(() => {
        if (!isCheckoutModalOpen) return;
        setSelectedSectionId("");
        fetchSections();
    }, [isCheckoutModalOpen]);

    useEffect(() => {
        if (!paymentDeepLink) return;

        const pp = pendingPaymentRef.current;
        const book = selectedBookRef.current;
        if (!pp || !book) {
            showToast("Payment detected but no pending purchase found.", "warning");
            onClearPaymentDeepLink();
            return;
        }

        if (paymentDeepLink !== pp.billCode) {
            showToast("Payment reference does not match.", "warning");
            onClearPaymentDeepLink();
            return;
        }

        setCheckoutLoading(true);
        getToyyibpayBillTransactions(pp.billCode)
            .then((transactions) => {
                const paid = transactions.some((t) => String(t.billpaymentStatus) === "1");
                if (!paid) {
                    showToast("Payment not completed yet. Tap Verify payment after paying.", "warning");
                    return;
                }
                return grantBookAccess(pp.bookId, pp.price, pp.sectionId).then(() => {
                    showToast(`Payment successful! "${book.title}" has been added to My Collection.`, "success");
                    setIsCheckoutModalOpen(false);
                    setPendingPayment(null);
                    pendingPaymentRef.current = null;
                    setSelectedBook(null);
                    selectedBookRef.current = null;
                    setSelectedSectionId("");
                    fetchCatalog();
                });
            })
            .catch((err: unknown) => {
                console.error("Auto-verify failed:", err);
                showToast("Auto-verify failed. Please tap Verify payment manually.", "error");
            })
            .finally(() => {
                setCheckoutLoading(false);
                onClearPaymentDeepLink();
            });
    }, [paymentDeepLink]);

    useEffect(() => {
        if (!pendingPayment) {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
            }
            return;
        }

        pollingRef.current = setInterval(async () => {
            const pp = pendingPaymentRef.current;
            const book = selectedBookRef.current;
            if (!pp || !book) return;

            try {
                const transactions = await getToyyibpayBillTransactions(pp.billCode);
                const paid = transactions.some((t) => String(t.billpaymentStatus) === "1");
                if (!paid) return;

                if (pollingRef.current) {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                }
                setCheckoutLoading(true);
                await grantBookAccess(pp.bookId, pp.price, pp.sectionId);
                showToast(`Payment successful! "${book.title}" has been added to My Collection.`, "success");
                setIsCheckoutModalOpen(false);
                setPendingPayment(null);
                pendingPaymentRef.current = null;
                setSelectedBook(null);
                selectedBookRef.current = null;
                setSelectedSectionId("");
                fetchCatalog();
                setCheckoutLoading(false);
            } catch {
                /* silent — retry on next poll */
            }
        }, 20000);

        return () => {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
            }
        };
    }, [pendingPayment]);

    async function fetchSections() {
        setSectionsLoading(true);
        setSectionsError(null);

        const { data: activeSemesters } = await supabase
            .from("semesters")
            .select("name")
            .eq("status", "active");

        const semesterNames = (activeSemesters || []).map(s => s.name);

        if (semesterNames.length === 0) {
            setSections([]);
            setSectionsError("No active semesters available.");
            setSectionsLoading(false);
            return;
        }

        const { data, error } = await supabase
            .from("sections")
            .select("id, name, semester")
            .eq("status", "active")
            .in("semester", semesterNames)
            .order("semester", { ascending: true })
            .order("name", { ascending: true });

        if (error) {
            console.error("Error fetching sections:", error.message);
            setSections([]);
            setSectionsError(error.message);
        } else {
            setSections(data || []);
            if ((data || []).length === 0) {
                setSectionsError("No active sections available. Ask a moderator to add sections.");
            }
        }
        setSectionsLoading(false);
    }

    async function fetchCatalog() {
        setLoading(true);
        setFetchError(null);

        const { data, error } = await supabase
            .from("books")
            .select("*")
            .eq("is_active", true)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Error fetching active catalog:", error.message);
            setFetchError("Failed to load catalog: " + error.message);
        } else if (session?.user?.id) {
            const { data: accessRows } = await supabase
                .from("book_access")
                .select("book_id")
                .eq("user_id", session.user.id);

            const purchasedIds = accessRows?.map((r) => r.book_id) || [];
            const parsedBooks = (data || []).map((b) => ({
                ...b,
                isPurchased: purchasedIds.includes(b.id),
            }));
            setBooks(parsedBooks);
        } else {
            setBooks(data || []);
        }
        setLoading(false);
    }

    const grantBookAccess = async (bookId: string, price: number, sectionId?: string | null) => {
        if (isGrantingRef.current) return;
        isGrantingRef.current = true;
        try {
            const { error: rpcError } = await supabase.rpc("complete_book_purchase", {
                p_book_id: bookId,
                p_price: price,
                p_section_id: sectionId || null,
            });

            if (!rpcError) return;

            console.warn("complete_book_purchase RPC:", rpcError.message);

            const { data: existing } = await supabase
                .from("book_access")
                .select("id")
                .eq("user_id", session?.user?.id)
                .eq("book_id", bookId)
                .maybeSingle();

            if (!existing) {
                const { error: accessError } = await supabase.from("book_access").insert({
                    user_id: session?.user?.id,
                    book_id: bookId,
                });
                if (accessError) throw accessError;
            }

            const { data: dupSale } = await supabase
                .from("sales")
                .select("id")
                .eq("buyer_email", session?.user?.email)
                .eq("book_id", bookId)
                .maybeSingle();

            if (!dupSale) {
                const { error: salesError } = await supabase.from("sales").insert({
                    book_id: bookId,
                    buyer_email: session?.user?.email,
                    price,
                    sale_type: "toyyibpay_fpx",
                    sold_at: new Date().toISOString(),
                    section_id: sectionId || null,
                });
                if (salesError) throw salesError;
            }
        } finally {
            isGrantingRef.current = false;
        }
    };

    const handleStartPayment = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!session?.user?.id) {
            showToast("Please sign in to purchase books.", "warning");
            return;
        }
        if (!selectedBook) return;
        if (!selectedSectionId) {
            showToast("Please select your class section.", "warning");
            return;
        }
        if (!buyerPhone.trim()) {
            showToast("Please enter your phone number for FPX payment.", "warning");
            return;
        }

        setCheckoutLoading(true);

        try {
            const amountCents = Math.round(Number(selectedBook.price) * 100);
            if (amountCents < 100) {
                throw new Error("Minimum payment amount is RM 1.00.");
            }

            const externalRef = `CS-${selectedBook.id.slice(0, 8)}-${Date.now()}`;
            
            // Log untuk debug di browser console
            console.log("Memulakan bayaran ToyyibPay:", { amountCents, externalRef, title: selectedBook.title });

            const bill = await createToyyibpayBill({
                billName: sanitizeToyyibpayText(selectedBook.title, 30),
                billDescription: sanitizeToyyibpayText(
                    selectedBook.author ? `${selectedBook.title} by ${selectedBook.author}` : selectedBook.title,
                    100
                ),
                billAmountCents: amountCents,
                billTo: sanitizeToyyibpayText(buyerName, 50),
                billEmail: buyerEmail.trim(),
                billPhone: buyerPhone.trim(),
                externalReferenceNo: externalRef,
                returnUrl: RETURN_URL,
                callbackUrl: RETURN_URL,
            });

            const newPending: PendingPayment = {
                billCode: bill.billCode,
                bookId: selectedBook.id,
                sectionId: selectedSectionId,
                price: Number(selectedBook.price),
            };
            setPendingPayment(newPending);
            pendingPaymentRef.current = newPending;

            console.log("Bil berjaya dicipta:", bill.billCode);

            await openUrl(bill.paymentUrl);
        } catch (err: unknown) {
            const msg = formatErrorMessage(err);
            console.error("Gagal memulakan bayaran ToyyibPay:", err);
            showToast("Gagal memulakan pembayaran: " + msg + "\n\nSila semak logs di Supabase Dashboard.", "error");
        } finally {
            setCheckoutLoading(false);
        }
    };

    const handleVerifyPayment = async () => {
        if (!pendingPayment || !selectedBook) return;

        setCheckoutLoading(true);

        try {
            const transactions = await getToyyibpayBillTransactions(pendingPayment.billCode);
            const paid = transactions.some((t) => String(t.billpaymentStatus) === "1");

            if (!paid) {
                showToast("Payment not completed yet. Finish paying on ToyyibPay, then tap Verify payment again.", "warning");
                return;
            }

            await grantBookAccess(
                pendingPayment.bookId,
                pendingPayment.price,
                pendingPayment.sectionId
            );

            showToast(`Payment successful! "${selectedBook.title}" has been added to My Collection.`, "success");

            setIsCheckoutModalOpen(false);
            setPendingPayment(null);
            pendingPaymentRef.current = null;
            setSelectedBook(null);
            selectedBookRef.current = null;
            setSelectedSectionId("");
            fetchCatalog();
        } catch (err: unknown) {
            console.error("Verify payment failed:", err);
            showToast("Error completing purchase: " + formatErrorMessage(err), "error");
        } finally {
            setCheckoutLoading(false);
        }
    };

    const closeCheckout = () => {
        setIsCheckoutModalOpen(false);
        setPendingPayment(null);
        pendingPaymentRef.current = null;
        setSelectedBook(null);
        selectedBookRef.current = null;
        setSelectedSectionId("");
    };

    const filteredBooks = books.filter(
        (book) =>
            book.title.toLowerCase().includes((bookSearch ?? "").toLowerCase()) ||
            (book.author && book.author.toLowerCase().includes((bookSearch ?? "").toLowerCase()))
    );

    useEffect(() => {
        onBuyBookCount?.(filteredBooks.length);
    }, [filteredBooks.length, onBuyBookCount]);

    const selectedSectionName = sections.find((s) => s.id === selectedSectionId);

    if (isOffline) {
        return (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "450px", padding: "40px", textAlign: "center", backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
                <div style={{ backgroundColor: "#ffebee", borderRadius: "50%", padding: "24px", marginBottom: "20px", display: "inline-flex", color: "#c62828" }}>
                    <ShoppingBag size={48} />
                </div>
                <h3 style={{ margin: "0 0 10px 0", color: "#333", fontSize: "1.4rem", fontWeight: "700" }}>Internet Connection Required</h3>
                <p style={{ margin: "0 0 25px 0", color: "#666", maxWidth: "420px", fontSize: "0.95rem", lineHeight: "1.6" }}>
                    You need to be connected to the internet to browse the store and make payments via ToyyibPay.
                </p>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "0.85rem", color: "#c62828", fontWeight: "600", backgroundColor: "#ffebee", padding: "6px 16px", borderRadius: "20px" }}>
                    <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#c62828" }}></span>
                    Currently Offline
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "30px" }}>
            <div>
                    {fetchError && (
                        <p
                            style={{
                                textAlign: "center",
                                color: "#c62828",
                                padding: "10px",
                                backgroundColor: "#ffebee",
                                borderRadius: "8px",
                            }}
                        >
                            {fetchError}
                        </p>
                    )}

                    {loading ? (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px", flexDirection: "column", gap: "12px" }}>
                            <div style={{ width: "36px", height: "36px", border: "3px solid #e0e0e0", borderTop: "3px solid #396cd8", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                            <p style={{ color: "#888", fontSize: "0.9rem" }}>Loading catalog...</p>
                        </div>
                    ) : filteredBooks.length === 0 ? (
                        <p style={{ textAlign: "center", color: "#666", padding: "20px 0" }}>
                            No books available right now. Check back later or contact support if you have a book PIN.
                        </p>
                    ) : (
                        <div className="books-grid">
                            {filteredBooks.map((book) => (
                                <div key={book.id} className="book-card">
                                    <div className="book-card-cover">
                                        {!book.cover_url ? (
                                            <div className="book-cover-offline">
                                                <img src="/logo.png" alt="" className="book-cover-logo" />
                                            </div>
                                        ) : (
                                            <img
                                                src={book.cover_url}
                                                alt={book.title}
                                                loading="lazy"
                                                className="book-cover-img"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).src = "/logo.png";
                                                }}
                                            />
                                        )}
                                        {book.isPurchased && (
                                            <div
                                                className="book-card-badge"
                                                style={{ backgroundColor: "#2e7d32" }}
                                            >
                                                Owned ✓
                                            </div>
                                        )}
                                    </div>
                                    <div className="book-card-details">
                                        <div>
                                            <h4 className="book-card-title" title={book.title}>
                                                {book.title}
                                            </h4>
                                            <p className="book-card-author">
                                                {book.author || "Unknown Author"}
                                            </p>
                                        </div>
                                        <div className="book-card-footer">
                                            <span className="book-card-price">
                                                RM {book.price ? book.price.toFixed(2) : "0.00"}
                                            </span>
                                            {book.isPurchased ? (
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    style={{
                                                        fontSize: "0.8rem",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: "5px",
                                                    }}
                                                    onClick={() => onOpenBook(book)}
                                                >
                                                    <BookOpen size={14} /> View Book
                                                </button>
                                            ) : (
                                                <button
                                                    className="btn btn-primary btn-sm"
                                                    style={{
                                                        backgroundColor: "#396cd8",
                                                        color: "white",
                                                        border: "none",
                                                        fontSize: "0.8rem",
                                                        padding: "6px 12px",
                                                    }}
                                                    onClick={() => {
                                                        setSelectedBook(book);
                                                        selectedBookRef.current = book;
                                                        setPendingPayment(null);
                                                        pendingPaymentRef.current = null;
                                                        setSelectedSectionId("");
                                                        setIsCheckoutModalOpen(true);
                                                    }}
                                                >
                                                    Buy Now
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

            {isCheckoutModalOpen && selectedBook && (
                <div className="modal-overlay">
                    <div
                        className="modal-content"
                        style={{ width: "480px", maxWidth: "100%", overflow: "hidden", padding: 0 }}
                    >
                        <div className="modal-header" style={{ padding: "20px", marginBottom: 0 }}>
                            <h4 style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                <CreditCard size={20} color="#396cd8" /> CloudShelf Purchase
                            </h4>
                            <button className="close-btn" onClick={closeCheckout}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ padding: "25px" }}>
                            <div
                                style={{
                                    display: "flex",
                                    gap: "15px",
                                    marginBottom: "20px",
                                    borderBottom: "1px solid #eee",
                                    paddingBottom: "15px",
                                }}
                            >
                                <img
                                    src={selectedBook.cover_url || "/logo.png"}
                                    alt="Cover"
                                    className={selectedBook.cover_url ? "" : "book-cover-logo"}
                                    style={{
                                        width: selectedBook.cover_url ? "60px" : "auto",
                                        height: selectedBook.cover_url ? "80px" : "auto",
                                        maxWidth: "60px",
                                        maxHeight: "80px",
                                        objectFit: "cover",
                                        borderRadius: "6px",
                                        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                                        flexShrink: 0,
                                    }}
                                />
                                <div>
                                    <h4 style={{ margin: "0 0 5px 0", color: "#111" }}>
                                        {selectedBook.title}
                                    </h4>
                                    <p style={{ margin: "0 0 5px 0", color: "#666", fontSize: "0.85rem" }}>
                                        {selectedBook.author}
                                    </p>
                                    <p
                                        style={{
                                            margin: "0",
                                            color: "#396cd8",
                                            fontWeight: "bold",
                                            fontSize: "1.1rem",
                                        }}
                                    >
                                        RM {selectedBook.price?.toFixed(2) ?? "N/A"}
                                    </p>
                                </div>
                            </div>

                                    {!pendingPayment ? (
                                <form onSubmit={handleStartPayment}>
                                    <div className="form-group">
                                        <label htmlFor="section-select">
                                            <UserCircle
                                                size={14}
                                                style={{ verticalAlign: "middle", marginRight: "4px" }}
                                            />
                                            Your class section *
                                        </label>
                                        <select
                                            id="section-select"
                                            className="form-control"
                                            value={selectedSectionId}
                                            onChange={(e) => setSelectedSectionId(e.target.value)}
                                            required
                                            disabled={sectionsLoading}
                                            style={{ padding: "8px" }}
                                        >
                                            <option value="" disabled>
                                                {sectionsLoading
                                                    ? "Loading sections..."
                                                    : sections.length > 0
                                                        ? "-- Please Select Your Section --"
                                                        : "-- No sections available --"}
                                            </option>
                                            {sections.map((section) => (
                                                <option key={section.id} value={section.id}>
                                                    {section.name} ({section.semester})
                                                </option>
                                            ))}
                                        </select>
                                        {sectionsError && !sectionsLoading && (
                                            <p
                                                style={{
                                                    fontSize: "0.75rem",
                                                    color: "#c62828",
                                                    marginTop: "6px",
                                                    lineHeight: 1.4,
                                                }}
                                            >
                                                {sectionsError}
                                            </p>
                                        )}
                                    </div>

                                    <div className="form-group" style={{ marginTop: "10px" }}>
                                        <label htmlFor="payer-name">Payer name *</label>
                                        <input
                                            id="payer-name"
                                            type="text"
                                            className="form-control"
                                            value={buyerName}
                                            onChange={(e) => setBuyerName(e.target.value)}
                                            required
                                        />
                                    </div>
                                    <div className="form-group" style={{ marginTop: "10px" }}>
                                        <label htmlFor="payer-email">Payer email *</label>
                                        <input
                                            id="payer-email"
                                            type="email"
                                            className="form-control"
                                            value={buyerEmail}
                                            onChange={(e) => setBuyerEmail(e.target.value)}
                                            required
                                        />
                                    </div>
                                    <div className="form-group" style={{ marginTop: "10px" }}>
                                        <label htmlFor="payer-phone">Payer phone (FPX) *</label>
                                        <input
                                            id="payer-phone"
                                            type="tel"
                                            className="form-control"
                                            placeholder="e.g. 0123456789"
                                            value={buyerPhone}
                                            onChange={(e) => setBuyerPhone(e.target.value)}
                                            required
                                        />
                                    </div>

                                    <div
                                        style={{
                                            marginTop: "15px",
                                            display: "flex",
                                            gap: "8px",
                                            alignItems: "center",
                                            fontSize: "0.75rem",
                                            color: "#666",
                                        }}
                                    >
                                        <ShieldCheck size={16} color="#2e7d32" />
                                        <span>
                                            Live ToyyibPay FPX — you will complete payment on
                                            toyyibpay.com.
                                        </span>
                                    </div>

                                    <button
                                        type="submit"
                                        className="btn btn-primary"
                                        style={{
                                            width: "100%",
                                            backgroundColor: "#2e7d32",
                                            color: "#fff",
                                            border: "none",
                                            marginTop: "15px",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: "8px",
                                        }}
                                        disabled={checkoutLoading}
                                    >
                                        {checkoutLoading ? (
                                            "Creating bill..."
                                        ) : (
                                            <>
                                                Pay with ToyyibPay <ArrowRight size={16} />
                                            </>
                                        )}
                                    </button>
                                </form>
                            ) : (
                                <div
                                    style={{
                                        border: "1px solid #c8e6c9",
                                        backgroundColor: "#f1f8e9",
                                        borderRadius: "8px",
                                        padding: "16px",
                                    }}
                                >
                                    <p style={{ margin: "0 0 8px 0", fontWeight: 600, color: "#2e7d32" }}>
                                        Payment opened in your browser
                                    </p>
                                    <p style={{ margin: "0 0 12px 0", fontSize: "0.85rem", color: "#555" }}>
                                        Section: <strong>{selectedSectionName ? `${selectedSectionName.name} (${selectedSectionName.semester})` : ""}</strong>
                                        <br />
                                        Bill code:{" "}
                                        <code style={{ fontSize: "0.8rem" }}>{pendingPayment.billCode}</code>
                                    </p>
                                    <p style={{ margin: "0 0 16px 0", fontSize: "0.8rem", color: "#666" }}>
                                        After paying on ToyyibPay, return here and verify to unlock the
                                        book.
                                    </p>
                                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                                        <button
                                            type="button"
                                            className="btn btn-primary"
                                            style={{
                                                flex: 1,
                                                minWidth: "140px",
                                                backgroundColor: "#396cd8",
                                                color: "#fff",
                                                border: "none",
                                            }}
                                            onClick={handleVerifyPayment}
                                        disabled={checkoutLoading || sections.length === 0}
                                        >
                                            {checkoutLoading ? "Verifying..." : "Verify payment"}
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            style={{ border: "1px solid #ccc" }}
                                            onClick={() =>
                                                openUrl(`https://toyyibpay.com/${pendingPayment.billCode}`)
                                            }
                                        >
                                            <ExternalLink size={14} style={{ marginRight: "4px" }} />
                                            Reopen payment
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
