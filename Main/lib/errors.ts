import type { PostgrestError } from "@supabase/supabase-js";

function isPostgrestError(err: unknown): err is PostgrestError {
    return (
        typeof err === "object" &&
        err !== null &&
        "message" in err &&
        typeof (err as PostgrestError).message === "string"
    );
}

/** Human-readable message for alerts and UI. */
export function formatErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (isPostgrestError(err)) {
        const parts = [err.message];
        if (err.details) parts.push(err.details);
        if (err.hint) parts.push(err.hint);
        if (err.code) parts.push(`(${err.code})`);
        return parts.filter(Boolean).join(" — ");
    }
    if (typeof err === "string") return err;
    if (typeof err === "object" && err !== null) {
        try {
            return JSON.stringify(err);
        } catch {
            return "Unknown error";
        }
    }
    return String(err);
}
