import { supabase } from "../supabaseClient";

export interface CreateToyyibpayBillRequest {
    billName: string;
    billDescription: string;
    billAmountCents: number;
    billTo: string;
    billEmail: string;
    billPhone: string;
    externalReferenceNo: string;
    returnUrl: string;
    callbackUrl: string;
}

export interface CreateToyyibpayBillResponse {
    billCode: string;
    paymentUrl: string;
}

export interface ToyyibpayTransaction {
    billpaymentStatus: string;
    billpaymentAmount?: string;
    billpaymentInvoiceNo?: string;
}

export function isTauriRuntime(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function createToyyibpayBill(
    payload: CreateToyyibpayBillRequest
): Promise<CreateToyyibpayBillResponse> {
    const { data, error } = await supabase.functions.invoke("toyyibpay", {
        body: { 
            action: "create_bill", 
            payload 
        }
    });

    if (error) throw error;
    if (data.error) throw new Error(data.error);
    return data;
}

export async function getToyyibpayBillTransactions(
    billCode: string
): Promise<ToyyibpayTransaction[]> {
    const { data, error } = await supabase.functions.invoke("toyyibpay", {
        body: { 
            action: "get_transactions", 
            payload: { billCode } 
        }
    });

    if (error) throw error;
    if (data.error) throw new Error(data.error);
    return data;
}

/** ToyyibPay bill fields: alphanumeric, space, underscore only. */
export function sanitizeToyyibpayText(value: string, maxLen: number): string {
    const cleaned = value.replace(/[^a-zA-Z0-9 _]/g, " ").replace(/\s+/g, " ").trim();
    return cleaned.slice(0, maxLen) || "CloudShelf";
}
