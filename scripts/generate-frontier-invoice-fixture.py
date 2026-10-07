from pathlib import Path
from tempfile import gettempdir
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "frontier-lab"
OUT.mkdir(parents=True, exist_ok=True)
PDF_PATH = OUT / "northstar_acme_october_invoice_dispute.pdf"
SCAN_PATH = Path(gettempdir()) / "routelab-frontier-amendment-scanned-section.png"

W, H = letter
NAVY = colors.HexColor("#142238")
INK = colors.HexColor("#1b2838")
MUTED = colors.HexColor("#617083")
GREEN = colors.HexColor("#1c9a62")
PALE = colors.HexColor("#edf4f1")
LINE = colors.HexColor("#d7dfe6")
ORANGE = colors.HexColor("#da7a32")


def font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            try:
                return ImageFont.truetype(candidate, size)
            except Exception:
                pass
    return ImageFont.load_default()


def make_scan():
    image = Image.new("RGB", (1450, 900), "#f2eee5")
    draw = ImageDraw.Draw(image)
    draw.rectangle((25, 22, 1422, 875), outline="#8e8a80", width=2)
    draw.text((70, 58), "ACME ROBOTICS ENTERPRISE AGREEMENT", font=font(28, True), fill="#26231f")
    draw.text((70, 102), "AMENDMENT #3 - EXECUTED COPY", font=font(22, True), fill="#26231f")
    draw.line((70, 145, 1370, 145), fill="#5c5850", width=2)
    lines = [
        "4. BILLING TERMS. Beginning with billing periods starting on or after October 1, 2026,",
        "excess usage shall be billed at $2.00 per 1,000 units. This term supersedes the excess",
        "usage price in the Northstar Enterprise Pricing Schedule effective January 1, 2025.",
        "",
        "5. SURCHARGES. The Regional Network Surcharge described in the January 2025 Pricing",
        "Schedule is eliminated beginning October 1, 2026. No regional network surcharge may",
        "be assessed for billing periods beginning on or after that date.",
        "",
        "6. CONTINUING TERMS. All other subscription and Premium Support fees remain unchanged.",
    ]
    y = 205
    for line in lines:
        draw.text((82, y), line, font=font(22), fill="#302d28")
        y += 52 if line else 30
    draw.text((82, 758), "Signed: September 18, 2026", font=font(20, True), fill="#302d28")
    draw.text((820, 758), "Effective: October 1, 2026", font=font(20, True), fill="#302d28")
    draw.line((80, 822, 560, 822), fill="#4c4943", width=2)
    draw.line((820, 822, 1300, 822), fill="#4c4943", width=2)
    image = image.rotate(-0.35, resample=Image.Resampling.BICUBIC, expand=True, fillcolor="#e5e1d9")
    image = image.filter(ImageFilter.GaussianBlur(0.25))
    image.save(SCAN_PATH, quality=92)


def header(c, title, subtitle=None, confidential=False):
    c.setFillColor(NAVY)
    c.rect(0, H - 92, W, 92, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 17)
    c.drawString(42, H - 48, title)
    if subtitle:
        c.setFont("Helvetica", 8.5)
        c.setFillColor(colors.HexColor("#c8d6e4"))
        c.drawString(42, H - 67, subtitle)
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(colors.HexColor("#64d89c"))
    c.drawRightString(W - 42, H - 48, "NORTHSTAR")
    if confidential:
        c.setFont("Helvetica", 7)
        c.setFillColor(colors.HexColor("#b7c4d0"))
        c.drawRightString(W - 42, H - 66, "CONFIDENTIAL CUSTOMER RECORD")


def footer(c, page, packet="Acme Robotics - October 2026 billing packet"):
    c.setStrokeColor(LINE)
    c.line(42, 38, W - 42, 38)
    c.setFont("Helvetica", 7.5)
    c.setFillColor(MUTED)
    c.drawString(42, 24, packet)
    c.drawRightString(W - 42, 24, f"Page {page} of 10")


def paragraph(c, text, x, y, width, size=9, leading=13, color=INK, bold=False):
    style = ParagraphStyle("body", fontName="Helvetica-Bold" if bold else "Helvetica", fontSize=size, leading=leading, textColor=color, alignment=TA_LEFT)
    p = Paragraph(text, style)
    _, h = p.wrap(width, H)
    p.drawOn(c, x, y - h)
    return y - h


def draw_table(c, data, x, y, widths, header_bg=NAVY, row_heights=None, font_size=8.5):
    table = Table(data, colWidths=widths, rowHeights=row_heights)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), header_bg),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), font_size),
        ("TEXTCOLOR", (0, 1), (-1, -1), INK),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("ALIGN", (-1, 0), (-1, -1), "RIGHT"),
    ]))
    tw, th = table.wrap(sum(widths), H)
    table.drawOn(c, x, y - th)
    return y - th


def page1(c):
    header(c, "INVOICE SUMMARY", "Invoice NS-AR-2026-10-4481", True)
    c.setFillColor(INK); c.setFont("Helvetica-Bold", 20); c.drawString(42, 655, "Acme Robotics")
    c.setFont("Helvetica", 9); c.setFillColor(MUTED)
    c.drawString(42, 636, "Billing period: October 1 - October 31, 2026")
    c.drawString(42, 620, "Issued: November 2, 2026   |   Due: December 2, 2026")
    c.setFillColor(PALE); c.roundRect(410, 606, 140, 72, 8, fill=1, stroke=0)
    c.setFillColor(MUTED); c.setFont("Helvetica-Bold", 7.5); c.drawString(426, 655, "AMOUNT DUE")
    c.setFillColor(NAVY); c.setFont("Helvetica-Bold", 24); c.drawString(426, 625, "$14,280.00")
    data = [["Description", "Quantity", "Rate", "Amount"], ["Enterprise Platform Subscription", "1", "$8,500.00", "$8,500.00"], ["Usage Overage", "1,500 x 1K", "$3.20", "$4,800.00"], ["Premium Support", "1", "$400.00", "$400.00"], ["Regional Network Surcharge", "1", "$580.00", "$580.00"]]
    y = draw_table(c, data, 42, 565, [250, 90, 90, 90])
    c.setFont("Helvetica-Bold", 11); c.setFillColor(INK); c.drawRightString(550, y - 28, "TOTAL   $14,280.00")
    c.setFont("Helvetica", 8); c.setFillColor(MUTED); c.drawString(42, 164, "Please reference invoice NS-AR-2026-10-4481 with payment.")
    footer(c, 1)


def page2(c):
    header(c, "OCTOBER API USAGE", "Production consumption report | October 1-31, 2026")
    c.setFillColor(INK); c.setFont("Helvetica-Bold", 16); c.drawString(42, 656, "Usage reconciliation")
    data = [["Metric", "Units"], ["Total October API usage", "3,500,000"], ["Enterprise plan included usage", "2,000,000"], ["Billable overage", "1,500,000"]]
    draw_table(c, data, 42, 620, [360, 160])
    c.setFillColor(PALE); c.roundRect(42, 352, 520, 150, 8, fill=1, stroke=0)
    c.setFillColor(MUTED); c.setFont("Helvetica-Bold", 8); c.drawString(60, 480, "CUMULATIVE API USAGE (MILLIONS)")
    points = [(82, 382, 0.55), (180, 399, 1.22), (278, 420, 2.05), (376, 443, 2.92), (520, 462, 3.5)]
    c.setStrokeColor(GREEN); c.setLineWidth(3)
    for a, b in zip(points, points[1:]): c.line(a[0], a[1], b[0], b[1])
    c.setFillColor(GREEN)
    for x, y, value in points:
        c.circle(x, y, 4, fill=1, stroke=0); c.setFont("Helvetica-Bold", 7); c.drawCentredString(x, y + 11, str(value))
    c.setStrokeColor(ORANGE); c.setDash(4, 3); c.line(60, 419, 544, 419); c.setDash()
    c.setFillColor(ORANGE); c.drawString(408, 424, "2.0M included")
    for x, label in [(82, "Oct 5"), (180, "Oct 12"), (278, "Oct 19"), (376, "Oct 26"), (520, "Oct 31")]:
        c.setFillColor(MUTED); c.setFont("Helvetica", 7); c.drawCentredString(x, 366, label)
    paragraph(c, "Usage source: Northstar production metering. Sandbox and failed requests are excluded. Units are rounded only for visual display; invoice calculations use exact counts.", 42, 320, 520, 8.5, 12, MUTED)
    footer(c, 2)


def page3(c):
    header(c, "USAGE DETAIL", "Regional and product allocation")
    c.setFont("Helvetica-Bold", 15); c.setFillColor(INK); c.drawString(42, 660, "October activity by service")
    data = [["Service", "US-East", "EU-West", "Total units"], ["Inference API", "1,460,000", "970,000", "2,430,000"], ["Document Processing", "420,000", "310,000", "730,000"], ["Batch Automation", "210,000", "130,000", "340,000"], ["Total", "2,090,000", "1,410,000", "3,500,000"]]
    y = draw_table(c, data, 42, 625, [190, 110, 110, 110])
    paragraph(c, "Regional allocation is provided for capacity planning. It does not independently establish whether a network surcharge applies; contractual billing terms govern.", 42, y - 35, 520, 9, 13, MUTED)
    footer(c, 3)


def page4(c):
    header(c, "NORTHSTAR ENTERPRISE PRICING SCHEDULE", "Effective January 1, 2025 | Schedule PS-2025-01")
    c.setFillColor(ORANGE); c.roundRect(42, 637, 520, 34, 6, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 9); c.drawString(56, 650, "PRICING SCHEDULE - EFFECTIVE JANUARY 1, 2025")
    data = [["Commercial term", "Rate"], ["Enterprise Platform Subscription", "$8,500 / month"], ["Included usage", "2,000,000 units / month"], ["Excess usage", "$3.20 per 1,000 units"], ["Regional Network Surcharge", "$580 / month"], ["Premium Support", "$400 / month"]]
    y = draw_table(c, data, 42, 605, [330, 190])
    paragraph(c, "This schedule applies unless modified by a later executed order form or amendment. Where terms conflict, the later executed document controls for periods on or after its effective date.", 42, y - 30, 520, 8.5, 12, MUTED)
    footer(c, 4)


def page5(c):
    header(c, "PRICING SCHEDULE NOTES", "Schedule PS-2025-01 | Commercial conditions")
    c.setFont("Helvetica-Bold", 15); c.setFillColor(INK); c.drawString(42, 656, "Usage tiers and discounts")
    data = [["Monthly usage", "Adjustment"], ["0 - 5,000,000 units", "Standard contracted rate"], ["Above 5,000,000 units", "8% volume discount on units above threshold"], ["Annual prepayment", "2% platform-fee discount if elected before term start"]]
    y = draw_table(c, data, 42, 620, [310, 210])
    paragraph(c, "Volume discounts are calculated only on usage above the stated threshold. Acme Robotics did not elect annual prepayment for the 2026 contract year.", 42, y - 32, 520, 9, 13, MUTED)
    c.setFillColor(PALE); c.roundRect(42, 250, 520, 96, 8, fill=1, stroke=0)
    paragraph(c, "Notice: pricing schedules are frequently amended by customer-specific agreements. Billing operations must verify all executed amendments whose effective date precedes the billing period.", 58, 320, 488, 10, 15, INK, True)
    footer(c, 5)


def page6(c):
    header(c, "ACME ROBOTICS ENTERPRISE AGREEMENT AMENDMENT #3", "Signed September 18, 2026 | Effective October 1, 2026", True)
    c.setFont("Helvetica-Bold", 15); c.setFillColor(INK); c.drawString(42, 654, "Commercial amendment summary")
    data = [["Section", "Amended term", "Effective"], ["Excess usage", "$2.00 per 1,000 units", "Oct 1, 2026"], ["Regional Network Surcharge", "Eliminated", "Oct 1, 2026"], ["Platform subscription", "Unchanged", "-"], ["Premium Support", "Unchanged", "-"]]
    y = draw_table(c, data, 42, 620, [170, 230, 120])
    paragraph(c, "The executed clauses and signatures continue on the following scanned page. In the event of conflict with the January 2025 Pricing Schedule, this Amendment #3 governs for billing periods beginning on or after October 1, 2026.", 42, y - 35, 520, 9.5, 14, INK)
    footer(c, 6)


def page7(c):
    header(c, "AMENDMENT #3 - SCANNED EXECUTED CLAUSES", "Image-based source page | OCR may be incomplete", True)
    c.drawImage(str(SCAN_PATH), 38, 98, width=536, height=514, preserveAspectRatio=True, anchor="c", mask="auto")
    c.setFont("Helvetica", 7.5); c.setFillColor(MUTED); c.drawString(42, 76, "Source: signed customer agreement archive. This page is intentionally image-based for document-vision evaluation.")
    footer(c, 7)


def page8(c):
    header(c, "PAYMENT TERMS AND SERVICE LEVELS", "Enterprise agreement reference")
    c.setFont("Helvetica-Bold", 15); c.setFillColor(INK); c.drawString(42, 656, "Payment terms")
    paragraph(c, "Invoices are due net 30 days from issue. A good-faith billing dispute submitted before the due date pauses collection activity only for the disputed portion. Undisputed balances remain payable.", 42, 625, 520, 9.5, 14)
    c.setFont("Helvetica-Bold", 15); c.drawString(42, 530, "Service level agreement")
    data = [["Measure", "Commitment", "October result"], ["API availability", "99.95%", "99.97%"], ["Priority-1 response", "30 minutes", "24 minutes"], ["Batch completion", "99.5%", "99.7%"]]
    draw_table(c, data, 42, 495, [240, 140, 140])
    footer(c, 8)


def page9(c):
    header(c, "HISTORICAL API USAGE", "Trailing six months | Planning reference only")
    c.setFont("Helvetica-Bold", 15); c.setFillColor(INK); c.drawString(42, 656, "Monthly API usage")
    values = [("May", 1.8), ("Jun", 2.1), ("Jul", 2.4), ("Aug", 2.7), ("Sep", 3.1), ("Oct", 3.5)]
    x0, y0, chart_w, chart_h = 68, 330, 460, 255
    c.setStrokeColor(LINE); c.line(x0, y0, x0, y0 + chart_h); c.line(x0, y0, x0 + chart_w, y0)
    max_v = 4.0
    for i, (label, value) in enumerate(values):
        x = x0 + 32 + i * 72
        height = value / max_v * (chart_h - 25)
        c.setFillColor(GREEN if label == "Oct" else colors.HexColor("#93c8ae")); c.roundRect(x, y0, 38, height, 4, fill=1, stroke=0)
        c.setFillColor(MUTED); c.setFont("Helvetica", 8); c.drawCentredString(x + 19, y0 - 18, label)
        c.setFillColor(INK); c.setFont("Helvetica-Bold", 8); c.drawCentredString(x + 19, y0 + height + 9, f"{value:.1f}M")
    paragraph(c, "Historical growth does not modify contracted rates. October billing must use the agreement terms effective for October 1-31, 2026.", 42, 278, 520, 9, 13, MUTED)
    footer(c, 9)


def page10(c):
    header(c, "PRIOR INVOICE", "September 2026 | Invoice NS-AR-2026-09-4117")
    c.setFont("Helvetica-Bold", 15); c.setFillColor(INK); c.drawString(42, 656, "September invoice summary")
    data = [["Description", "Amount"], ["Enterprise Platform Subscription", "$8,500.00"], ["Usage Overage", "$3,520.00"], ["Premium Support", "$400.00"], ["Regional Network Surcharge", "$580.00"], ["Total", "$13,000.00"]]
    y = draw_table(c, data, 42, 620, [360, 160])
    paragraph(c, "This invoice covers September 1-30, 2026. Amendment #3 was not effective during this billing period. Prior-period treatment does not determine October pricing.", 42, y - 35, 520, 9.5, 14, MUTED)
    footer(c, 10)


def main():
    try:
        make_scan()
        c = canvas.Canvas(str(PDF_PATH), pagesize=letter, pageCompression=1)
        for page in [page1, page2, page3, page4, page5, page6, page7, page8, page9, page10]:
            page(c)
            c.showPage()
        c.save()
    finally:
        SCAN_PATH.unlink(missing_ok=True)
    print(PDF_PATH)


if __name__ == "__main__":
    main()
