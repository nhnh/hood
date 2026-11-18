export interface PrintNoteItem {
    heading: string;
    date: string;
    content: string;
}

export interface PrintNoteSection {
    title: string;
    items: PrintNoteItem[];
}

export function printNotesAsPdf(sections: PrintNoteSection[], docTitle: string): void {
    const dateStr = new Date().toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
    });

    let contentHtml = '';

    let sectionCount = 0;
    for (const section of sections) {
        if (section.items.length === 0) continue;
        sectionCount++;
        if (sectionCount > 1) {
            contentHtml += `<div style="height:1px;background:#999;margin:15px 0"></div>`;
        }
        if (sectionCount === 1) {
            contentHtml += `<div style="margin-bottom:20px"><div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #396cd8;padding-bottom:6px">
                <h2 style="font-size:18px;color:#396cd8;margin:0">${escapeHtml(section.title)}</h2>
                <span style="font-size:12px;color:#888">Exported on ${dateStr}</span>
            </div>`;
        } else {
            contentHtml += `<div style="margin-bottom:20px"><h2 style="font-size:18px;color:#396cd8;border-bottom:2px solid #396cd8;padding-bottom:6px">${escapeHtml(section.title)}</h2>`;
        }
        for (const item of section.items) {
            contentHtml += `<div style="margin:12px 0;padding:10px 14px;background:#f9f9f9;page-break-inside:avoid;font-size:14px;line-height:1.6">
                <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-weight:bold;font-size:15px;margin-bottom:4px">
                    <span>${escapeHtml(item.heading)}</span>
                    <span style="font-size:12px;color:#999;font-weight:normal;white-space:nowrap">${escapeHtml(item.date)}</span>
                </div>
                <div>${item.content}</div>
            </div>`;
        }
        contentHtml += `</div>`;
    }

    injectAndPrint(contentHtml, docTitle);
}

function injectAndPrint(html: string, docTitle: string): void {
    const printWin = window.open("", "_blank", "width=800,height=600");
    if (printWin) {
        printWin.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(docTitle)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #222; }
  @media print { body { padding: 20px; } }
</style></head><body>${html}</body></html>`);
        printWin.document.close();
        printWin.focus();
        printWin.print();
        return;
    }

    const container = document.createElement("div");
    container.id = "print-container";
    container.style.cssText = "padding:40px;font-family:Georgia,'Times New Roman',serif;color:#222;max-width:800px;margin:0 auto;";
    container.innerHTML = html;
    document.body.appendChild(container);
    window.print();
    document.body.removeChild(container);
}

function escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
