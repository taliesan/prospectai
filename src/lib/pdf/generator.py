#!/usr/bin/env python3
"""
ProspectAI PDF Generator — ProspectAI Design System

Generates a professionally designed PDF from profile JSON data.
Content-agnostic layout engine that applies the ProspectAI design system
to whatever structured data the AI produces.

Usage: python3 generator.py <input.json> <output.pdf>
"""

import json
import os
import sys
import re

from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Flowable,
    KeepTogether, BaseDocTemplate, Frame, PageTemplate, NextPageTemplate,
)
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT, TA_JUSTIFY, TA_CENTER, TA_RIGHT
from reportlab.lib.units import inch
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFont, registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, Color

# ─── Design tokens ───────────────────────────────────────────────────────────

CHARCOAL     = HexColor('#1A1A1A')
WARM_WHITE   = HexColor('#FAF8F5')
PARCHMENT    = HexColor('#F5F3EF')
STONE        = HexColor('#E8E5E0')
BODY_TEXT    = HexColor('#1f2937')       # gray-800 — matches web
BODY_BOLD    = HexColor('#111827')       # gray-900
HEADING_GRAY = HexColor('#6b7280')       # gray-500 — section headings
SUBHEAD_GRAY = HexColor('#374151')       # gray-700 — sub-headings
BULLET_GRAY  = HexColor('#9ca3af')       # gray-400 — bullet dots
LIGHT_GRAY   = HexColor('#9ca3af')       # gray-400
FOOTER_GRAY  = HexColor('#9ca3af')       # gray-400
WHITE        = HexColor('#FFFFFF')
PURPLE       = HexColor('#7B2D8E')
PURPLE_LIGHT = HexColor('#D894E8')
GREEN        = HexColor('#2D6A4F')
GREEN_LIGHT  = HexColor('#40916C')
CORAL        = HexColor('#E07A5F')
BLUE         = HexColor('#3B82F6')

GRADIENT_STOPS = [
    (0.0, PURPLE),
    (0.33, GREEN),
    (0.66, CORAL),
    (1.0, PURPLE),
]

# Section accent colors
SECTION_ACCENT = {
    'briefing_note': BLUE,
    'persuasion_profile': PURPLE_LIGHT,
    'meeting_guide': GREEN_LIGHT,
    'sources': CORAL,
}

PAGE_WIDTH, PAGE_HEIGHT = letter
MARGIN = 54  # 0.75in
CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN


# ─── Font registration ────────────────────────────────────────────────────────

def register_fonts():
    """Register Google Fonts TTF files. Falls back to Helvetica if not found."""
    font_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../public/fonts')
    font_dir = os.path.normpath(font_dir)

    fonts_registered = {'serif': False, 'sans': False}

    # Instrument Serif
    serif_regular = os.path.join(font_dir, 'InstrumentSerif-Regular.ttf')
    serif_italic = os.path.join(font_dir, 'InstrumentSerif-Italic.ttf')

    if os.path.exists(serif_regular):
        registerFont(TTFont('InstrumentSerif', serif_regular))
        if os.path.exists(serif_italic):
            registerFont(TTFont('InstrumentSerif-Italic', serif_italic))
        else:
            registerFont(TTFont('InstrumentSerif-Italic', serif_regular))
        registerFontFamily(
            'InstrumentSerif',
            normal='InstrumentSerif',
            bold='InstrumentSerif',
            italic='InstrumentSerif-Italic',
            boldItalic='InstrumentSerif-Italic',
        )
        fonts_registered['serif'] = True
        print('[PDF] Registered InstrumentSerif fonts')
    else:
        print(f'[PDF] InstrumentSerif not found at {serif_regular}, using Helvetica')

    # DM Sans
    sans_files = {
        'DMSans': 'DMSans-Regular.ttf',
        'DMSans-Bold': 'DMSans-Bold.ttf',
        'DMSans-Italic': 'DMSans-Italic.ttf',
        'DMSans-BoldItalic': 'DMSans-BoldItalic.ttf',
        'DMSans-Light': 'DMSans-Light.ttf',
        'DMSans-Medium': 'DMSans-Medium.ttf',
    }

    all_sans = True
    for name, filename in sans_files.items():
        path = os.path.join(font_dir, filename)
        if os.path.exists(path):
            registerFont(TTFont(name, path))
        else:
            all_sans = False
            regular = os.path.join(font_dir, 'DMSans-Regular.ttf')
            if os.path.exists(regular):
                registerFont(TTFont(name, regular))

    if all_sans or os.path.exists(os.path.join(font_dir, 'DMSans-Regular.ttf')):
        registerFontFamily(
            'DMSans',
            normal='DMSans',
            bold='DMSans-Bold',
            italic='DMSans-Italic',
            boldItalic='DMSans-BoldItalic',
        )
        fonts_registered['sans'] = True
        print('[PDF] Registered DMSans fonts')
    else:
        print('[PDF] DMSans not found, using Helvetica')

    return fonts_registered


# ─── Style factory ────────────────────────────────────────────────────────────

def make_styles(fonts):
    """Create all paragraph styles using registered fonts."""
    serif = 'InstrumentSerif' if fonts['serif'] else 'Times-Roman'
    sans = 'DMSans' if fonts['sans'] else 'Helvetica'
    sans_bold = sans + '-Bold' if fonts['sans'] else 'Helvetica-Bold'
    sans_italic = sans + '-Italic' if fonts['sans'] else 'Helvetica-Oblique'
    sans_light = 'DMSans-Light' if fonts['sans'] else 'Helvetica'
    sans_medium = 'DMSans-Medium' if fonts['sans'] else 'Helvetica'

    return {
        # Cover page
        'cover_overline': ParagraphStyle(
            'cover_overline', fontName=sans, fontSize=8.5,
            leading=12, textColor=PURPLE_LIGHT, alignment=TA_LEFT,
            spaceAfter=8,
        ),
        'cover_name': ParagraphStyle(
            'cover_name', fontName=serif, fontSize=52,
            leading=58, textColor=WHITE, alignment=TA_LEFT,
            spaceAfter=6,
        ),
        'cover_subtitle': ParagraphStyle(
            'cover_subtitle', fontName=sans_light, fontSize=14,
            leading=20, textColor=Color(1, 1, 1, 0.6), alignment=TA_LEFT,
            spaceAfter=40,
        ),
        'cover_meta_value': ParagraphStyle(
            'cover_meta_value', fontName=sans, fontSize=9,
            leading=20, textColor=Color(1, 1, 1, 0.7), alignment=TA_LEFT,
        ),
        'cover_footer': ParagraphStyle(
            'cover_footer', fontName=sans, fontSize=7.5,
            leading=11, textColor=Color(1, 1, 1, 0.25), alignment=TA_CENTER,
        ),

        # Content pages — section headings (E: 9pt, medium, uppercase, gray-500)
        'heading': ParagraphStyle(
            'heading', fontName=sans_medium, fontSize=9,
            leading=13, textColor=HEADING_GRAY, alignment=TA_LEFT,
            spaceBefore=0, spaceAfter=8,
        ),
        # Sub-headings (F: 10pt, medium, gray-700)
        'subheading': ParagraphStyle(
            'subheading', fontName=sans_medium, fontSize=10,
            leading=14, textColor=SUBHEAD_GRAY, alignment=TA_LEFT,
            spaceBefore=12, spaceAfter=6,
        ),
        # Body text (G: 10.5pt, regular, gray-800, leading ~1.7)
        'body': ParagraphStyle(
            'body', fontName=sans, fontSize=10.5,
            leading=18, textColor=BODY_TEXT, alignment=TA_JUSTIFY,
            spaceAfter=8,
        ),
        # Bold lead sentences (H: same size, medium weight, gray-900)
        'body_bold': ParagraphStyle(
            'body_bold', fontName=sans_medium, fontSize=10.5,
            leading=18, textColor=BODY_BOLD, alignment=TA_JUSTIFY,
            spaceAfter=8,
        ),
        'body_italic': ParagraphStyle(
            'body_italic', fontName=sans_italic, fontSize=10.5,
            leading=18, textColor=BODY_TEXT, alignment=TA_JUSTIFY,
            spaceAfter=8,
        ),
        'insight': ParagraphStyle(
            'insight', fontName=sans_italic, fontSize=10.5,
            leading=18, textColor=BODY_TEXT, alignment=TA_LEFT,
        ),
        # Bullets (N: disc only, gray-400 bullet, body text size)
        # leftIndent=14 sets text body indent; firstLineIndent=-14 outdents bullet to left edge.
        # Wrapped lines align with text start past the bullet symbol.
        'bullet': ParagraphStyle(
            'bullet', fontName=sans, fontSize=10.5,
            leading=18, textColor=BODY_TEXT, alignment=TA_LEFT,
            leftIndent=14, firstLineIndent=-14, spaceAfter=6,
        ),
        'profile_bullet': ParagraphStyle(
            'profile_bullet', fontName=sans, fontSize=10.5,
            leading=18, textColor=BODY_TEXT, alignment=TA_LEFT,
            leftIndent=14, firstLineIndent=-14, spaceAfter=8,
        ),

        # Footer (Q: 7pt, gray-400)
        'footer_left': ParagraphStyle(
            'footer_left', fontName=sans, fontSize=7,
            leading=10, textColor=FOOTER_GRAY, alignment=TA_LEFT,
        ),
        'footer_right': ParagraphStyle(
            'footer_right', fontName=sans, fontSize=7,
            leading=10, textColor=FOOTER_GRAY, alignment=TA_RIGHT,
        ),

        # Sources
        'source_title': ParagraphStyle(
            'source_title', fontName=sans, fontSize=7.5,
            leading=11, textColor=CHARCOAL, alignment=TA_LEFT,
        ),
        'source_domain': ParagraphStyle(
            'source_domain', fontName=sans_light, fontSize=6.5,
            leading=10, textColor=LIGHT_GRAY, alignment=TA_LEFT,
        ),

        # Card styles (meeting guide beats)
        'card_title': ParagraphStyle(
            'card_title', fontName=sans_bold, fontSize=11,
            leading=15, textColor=CHARCOAL, alignment=TA_LEFT,
        ),
        'card_body': ParagraphStyle(
            'card_body', fontName=sans, fontSize=9,
            leading=13, textColor=BODY_TEXT, alignment=TA_LEFT,
        ),
        'card_label': ParagraphStyle(
            'card_label', fontName=sans_bold, fontSize=7.5,
            leading=10, textColor=LIGHT_GRAY, alignment=TA_LEFT,
        ),

        # Section title (two-line: small label + large serif name)
        'title_label': ParagraphStyle(
            'title_label', fontName=sans_medium, fontSize=8,
            leading=11, textColor=LIGHT_GRAY, alignment=TA_LEFT,
        ),
        'title_name': ParagraphStyle(
            'title_name', fontName=serif, fontSize=24,
            leading=28, textColor=CHARCOAL, alignment=TA_LEFT,
        ),

        # Confidence badge
        'confidence_badge': ParagraphStyle(
            'confidence_badge', fontName=sans_medium, fontSize=7,
            leading=10, textColor=WHITE, alignment=TA_CENTER,
        ),
    }


# ─── Canvas drawing helpers ───────────────────────────────────────────────────

def _interpolate_gradient(t, stops):
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        if t0 <= t <= t1:
            frac = (t - t0) / (t1 - t0) if t1 > t0 else 0
            r = c0.red + (c1.red - c0.red) * frac
            g = c0.green + (c1.green - c0.green) * frac
            b = c0.blue + (c1.blue - c0.blue) * frac
            return Color(r, g, b)
    return stops[-1][1]


def draw_gradient_bar(canvas, x, y, width, height):
    """Draw gradient bar at specified position."""
    steps = 200
    sw = width / steps
    for i in range(steps):
        t = i / steps
        color = _interpolate_gradient(t, GRADIENT_STOPS)
        canvas.setFillColor(color)
        canvas.rect(x + i * sw, y, sw + 0.5, height, stroke=0, fill=1)


def draw_dark_page(canvas, doc):
    """Background for cover and section cover pages."""
    canvas.saveState()
    canvas.setFillColor(CHARCOAL)
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)

    # Gradient bar at top
    draw_gradient_bar(canvas, 0, PAGE_HEIGHT - 6, PAGE_WIDTH, 6)

    # Subtle radial glows
    canvas.setFillColor(Color(0.482, 0.176, 0.557, 0.08))
    canvas.circle(PAGE_WIDTH * 0.75, PAGE_HEIGHT * 0.7, 200, stroke=0, fill=1)
    canvas.setFillColor(Color(0.176, 0.416, 0.310, 0.06))
    canvas.circle(PAGE_WIDTH * 0.25, PAGE_HEIGHT * 0.3, 180, stroke=0, fill=1)

    canvas.restoreState()


def draw_content_page(canvas, doc):
    """Background for content pages — warm white with thin gradient bar."""
    canvas.saveState()
    canvas.setFillColor(WARM_WHITE)
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)

    # Thin gradient bar at top
    draw_gradient_bar(canvas, 0, PAGE_HEIGHT - 3, PAGE_WIDTH, 3)

    # Footer (Q: 7pt, lighter color, page number right-aligned)
    sans = 'DMSans' if 'DMSans' in canvas.getAvailableFonts() else 'Helvetica'
    canvas.setFont(sans, 7)
    canvas.setFillColor(FOOTER_GRAY)
    canvas.drawString(MARGIN, 24, 'ProspectAI \u00b7 Confidential')
    canvas.drawRightString(PAGE_WIDTH - MARGIN, 24, str(canvas.getPageNumber()))

    canvas.restoreState()


# ─── Section title flowable ───────────────────────────────────────────────────

def _spaced_text(text):
    """Convert to wide tracking: spaces between chars, triple spaces between words."""
    words = text.upper().split()
    return '   '.join(' '.join(word) for word in words)


class SectionTitleFlowable(Flowable):
    """Two-line section title: small uppercase label + large serif name + thick divider."""

    def __init__(self, label, name, width, styles):
        super().__init__()
        self.label_text = _spaced_text(label)
        self.name_text = name.upper()
        self.box_width = width
        self.styles = styles
        self._label_para = None
        self._name_para = None
        self._lh = 0
        self._nh = 0
        self._h = 0

    def wrap(self, aW, aH):
        self._label_para = Paragraph(self.label_text, self.styles['title_label'])
        _, self._lh = self._label_para.wrap(self.box_width, aH)
        self._name_para = Paragraph(self.name_text, self.styles['title_name'])
        _, self._nh = self._name_para.wrap(self.box_width, aH)
        self._h = self._lh + 2 + self._nh + 10 + 2 + 12
        return (self.box_width, self._h)

    def draw(self):
        c = self.canv
        h = self._h
        label_bottom = h - self._lh
        self._label_para.drawOn(c, 0, label_bottom)
        name_bottom = label_bottom - 2 - self._nh
        self._name_para.drawOn(c, 0, name_bottom)
        divider_y = name_bottom - 10
        c.setStrokeColor(CHARCOAL)
        c.setLineWidth(2)
        c.line(0, divider_y, self.box_width, divider_y)


# ─── Confidence badge flowable (I) ───────────────────────────────────────────

class ConfidenceBadge(Flowable):
    """Small inline confidence badge: filled/empty squares + score text."""

    def __init__(self, score, width=None):
        super().__init__()
        self.score = score
        self.box_width = width or CONTENT_WIDTH

    def wrap(self, aW, aH):
        return (self.box_width, 14)

    def draw(self):
        c = self.canv
        score = self.score
        badge_bg = (
            HexColor('#ef4444') if score <= 3
            else HexColor('#f59e0b') if score <= 5
            else HexColor('#fbbf24') if score <= 7
            else HexColor('#22c55e')
        )

        # Draw the badge pill
        text = f'Confidence {score}/10'
        sans = 'DMSans-Medium' if 'DMSans-Medium' in c.getAvailableFonts() else 'Helvetica'
        c.setFont(sans, 7)
        tw = c.stringWidth(text, sans, 7)
        pill_w = tw + 10
        pill_h = 12
        # Right-align the badge
        x = self.box_width - pill_w
        c.setFillColor(badge_bg)
        c.roundRect(x, 1, pill_w, pill_h, pill_h / 2, stroke=0, fill=1)
        c.setFillColor(WHITE)
        c.drawString(x + 5, 4, text)


# ─── Accent line flowable ────────────────────────────────────────────────────

class AccentLineFlowable(Flowable):
    """Colored accent bar at top of content section (O)."""

    def __init__(self, color, width=None):
        super().__init__()
        self.color = color
        self.bar_width = width or CONTENT_WIDTH

    def wrap(self, aW, aH):
        return (self.bar_width, 6)

    def draw(self):
        self.canv.setFillColor(self.color)
        self.canv.rect(0, 2, self.bar_width, 3, stroke=0, fill=1)


# ─── Divider rule flowable ───────────────────────────────────────────────────

class SectionDivider(Flowable):
    """Thin gray rule above each H2 section heading."""

    def __init__(self, width=None):
        super().__init__()
        self.bar_width = width or CONTENT_WIDTH

    def wrap(self, aW, aH):
        return (self.bar_width, 20)

    def draw(self):
        self.canv.setStrokeColor(HexColor('#e5e7eb'))
        self.canv.setLineWidth(0.5)
        self.canv.line(0, 10, self.bar_width, 10)


# ─── Content builders ─────────────────────────────────────────────────────────

def build_cover_page(data, styles):
    """Build cover page flowables (P: updated subtitle and source count)."""
    elements = []
    elements.append(Spacer(1, PAGE_HEIGHT * 0.35))

    overline = 'P R O S P E C T A I   D O N O R   I N T E L L I G E N C E'
    elements.append(Paragraph(overline, styles['cover_overline']))
    elements.append(Paragraph(data['donorName'], styles['cover_name']))

    # P: Updated subtitle
    elements.append(Paragraph(
        'Briefing Note, Behavioral Profile &amp; Meeting Strategy',
        styles['cover_subtitle']
    ))

    meta_items = []
    if data.get('preparedFor'):
        meta_items.append(f"<b>Prepared for</b>  {data['preparedFor']}")
    meta_items.append(f"<b>Date</b>  {data.get('date', '')}")
    meta_items.append(f"<b>Classification</b>  Confidential \u2014 Internal Use Only")

    # P: Actual source count from payload
    source_count = len(data.get('sources', []))
    if source_count > 0:
        meta_items.append(f"<b>Sources</b>  {source_count} verified references")
    else:
        meta_items.append(f"<b>Sources</b>  See sources page")

    for item in meta_items:
        elements.append(Paragraph(item, styles['cover_meta_value']))

    # One Line — centered serif text on cover
    one_line = data.get('oneLine', '')
    if one_line:
        elements.append(Spacer(1, 30))
        one_line_style = ParagraphStyle(
            'cover_one_line',
            fontName='InstrumentSerif',
            fontSize=12,
            leading=18,
            textColor=HexColor('#e5e7eb'),
            alignment=TA_CENTER,
        )
        # Center with max-width ~70% of page
        max_w = CONTENT_WIDTH * 0.7
        pad = (CONTENT_WIDTH - max_w) / 2
        ol_style = ParagraphStyle(
            'cover_one_line_padded',
            parent=one_line_style,
            leftIndent=pad,
            rightIndent=pad,
        )
        elements.append(Paragraph(_escape_xml(one_line), ol_style))

    elements.append(Spacer(1, 50))
    elements.append(Paragraph(
        'Generated by ProspectAI \u00b7 Confidential \u00b7 Internal Use Only',
        styles['cover_footer']
    ))

    return elements


def _build_section_heading(title, styles, confidence_scores=None, is_first=False):
    """Build a consistent H2 section heading with optional confidence badge (M, K)."""
    elements = []

    if not is_first:
        elements.append(Spacer(1, 16))
        elements.append(SectionDivider())
        elements.append(Spacer(1, 4))

    # Heading text — uppercase in the PDF (E)
    heading_text = title.upper()
    # Expand letter spacing manually for the small-caps look
    spaced = '&nbsp;'.join(heading_text) if len(heading_text) < 40 else heading_text
    elements.append(Paragraph(heading_text, styles['heading']))

    # Confidence badge (K)
    if confidence_scores:
        # Fuzzy match section name
        score = _lookup_confidence(title, confidence_scores)
        if score is not None:
            elements.append(ConfidenceBadge(score))

    return elements


PHASE_COLORS = {
    'START': {'label_bg': '#0f766e', 'content_bg': '#f0fdfa', 'border': '#99f6e4'},
    'STAY': {'label_bg': '#1e40af', 'content_bg': '#eff6ff', 'border': '#bfdbfe'},
    'CONTINUE': {'label_bg': '#7e22ce', 'content_bg': '#faf5ff', 'border': '#d8b4fe'},
}


def _build_phase_box(label, content_paragraphs, styles):
    """Build a phase box with colored pill label and tinted content background.

    content_paragraphs: list of (type, text) tuples where type is 'text', 'bullet', or 'stalling'.
    """
    colors = PHASE_COLORS.get(label, PHASE_COLORS['START'])

    class PhaseBoxFlowable(Flowable):
        def __init__(self, label_text, paras, box_width, colors_dict):
            super().__init__()
            self.label_text = label_text
            self.paras = paras
            self.box_width = box_width
            self.colors = colors_dict
            self._pill_h = 16
            self._pill_w = 0
            self._content_paras = []
            self._h = 0

        def wrap(self, aW, aH):
            inner_w = self.box_width - 28  # 14px padding each side
            self._content_paras = []
            total_content_h = 0

            for ptype, text in self.paras:
                if ptype == 'bullet':
                    style = ParagraphStyle(
                        'phase_bullet', fontName='DMSans', fontSize=10.5,
                        leading=18, textColor=BODY_TEXT, alignment=TA_LEFT,
                        leftIndent=14, firstLineIndent=-14,
                    )
                    p = Paragraph(
                        f'<font color="{BULLET_GRAY.hexval()}">\u2022</font>  {text}',
                        style
                    )
                else:
                    style = ParagraphStyle(
                        'phase_body', fontName='DMSans', fontSize=10.5,
                        leading=18, textColor=BODY_TEXT, alignment=TA_LEFT,
                    )
                    p = Paragraph(text, style)
                pw, ph = p.wrap(inner_w, aH)
                self._content_paras.append((p, ph))
                total_content_h += ph + 6  # 6pt gap between items

            if self._content_paras:
                total_content_h -= 6  # remove last gap

            # Pill sizing
            font = 'DMSans-Bold'
            try:
                pdfmetrics.getFont(font)
            except Exception:
                font = 'Helvetica-Bold'
            self._pill_font = font
            tw = pdfmetrics.stringWidth(self.label_text, font, 7)
            self._pill_w = tw + 14

            # Total: pill (overlaps top of box by half) + content padding
            self._content_h = total_content_h + 20  # 10px top + 10px bottom padding
            self._h = self._pill_h // 2 + self._content_h + 4  # 4pt bottom margin
            return (self.box_width, self._h)

        def draw(self):
            c = self.canv
            box_top = self._h - 4 - self._pill_h // 2

            # Content background box
            c.setFillColor(HexColor(self.colors['content_bg']))
            c.setStrokeColor(HexColor(self.colors['border']))
            c.setLineWidth(0.5)
            c.roundRect(0, 0, self.box_width, box_top, 4, stroke=1, fill=1)

            # Pill label
            pill_y = box_top - self._pill_h // 2
            c.setFillColor(HexColor(self.colors['label_bg']))
            c.roundRect(6, pill_y, self._pill_w, self._pill_h, self._pill_h // 2, stroke=0, fill=1)
            c.setFillColor(WHITE)
            c.setFont(self._pill_font, 7)
            c.drawString(13, pill_y + 5, self.label_text)

            # Content paragraphs
            y = box_top - self._pill_h // 2 - 10  # start below pill overlap + padding
            for para, ph in self._content_paras:
                y -= ph
                para.drawOn(c, 14, y)
                y -= 6

    return PhaseBoxFlowable(label, content_paragraphs, CONTENT_WIDTH, colors)


def _build_tripwire_card(name, tell, recovery, styles):
    """Build a tripwire card with red left border."""
    class TripwireFlowable(Flowable):
        def __init__(self, name, tell, recovery, width):
            super().__init__()
            self.name_text = name
            self.tell_text = tell
            self.recovery_text = recovery
            self.box_width = width
            self._paras = []
            self._h = 0

        def wrap(self, aW, aH):
            inner = self.box_width - 28  # 4px border + 12px padding each side
            self._paras = []
            total_h = 16  # top+bottom padding

            name_style = ParagraphStyle('tw_name', fontName='DMSans-Bold', fontSize=9.5,
                                         leading=13, textColor=HexColor('#991b1b'))
            name_p = Paragraph(f'{_escape_xml(self.name_text)}.', name_style)
            _, nh = name_p.wrap(inner, aH)
            self._paras.append(('name', name_p, nh))
            total_h += nh + 4

            body_style = ParagraphStyle('tw_body', fontName='DMSans', fontSize=10,
                                         leading=16, textColor=BODY_TEXT)
            if self.tell_text:
                tell_p = Paragraph(
                    f'<font color="#991b1b"><b>Tell:</b></font> <i>{_escape_xml(self.tell_text)}</i>',
                    body_style
                )
                _, th = tell_p.wrap(inner, aH)
                self._paras.append(('tell', tell_p, th))
                total_h += th + 2

            if self.recovery_text:
                rec_p = Paragraph(
                    f'<font color="#991b1b"><b>Recovery:</b></font> {_escape_xml(self.recovery_text)}',
                    body_style
                )
                _, rh = rec_p.wrap(inner, aH)
                self._paras.append(('rec', rec_p, rh))
                total_h += rh

            self._h = total_h
            return (self.box_width, self._h)

        def draw(self):
            c = self.canv
            # Red-tinted background
            c.setFillColor(HexColor('#fef2f2'))
            c.roundRect(4, 0, self.box_width - 4, self._h, 4, stroke=0, fill=1)
            # Red left border
            c.setFillColor(HexColor('#991b1b'))
            c.rect(0, 0, 4, self._h, stroke=0, fill=1)
            # Border
            c.setStrokeColor(HexColor('#fecaca'))
            c.setLineWidth(0.5)
            c.roundRect(4, 0, self.box_width - 4, self._h, 4, stroke=1, fill=0)

            y = self._h - 8
            for label, para, h in self._paras:
                y -= h
                para.drawOn(c, 16, y)
                y -= (4 if label == 'name' else 2)

    return TripwireFlowable(name, tell, recovery, CONTENT_WIDTH)


def _lookup_confidence(heading, scores):
    """Fuzzy-match heading against confidence scores dict."""
    if not scores:
        return None
    heading_lower = heading.lower().strip()
    for name, score in scores.items():
        name_lower = name.lower().strip()
        # Check if first two words match
        h_words = heading_lower.split()[:2]
        n_words = name_lower.split()[:2]
        if h_words == n_words:
            return score
        # Check if one contains the other
        if heading_lower in name_lower or name_lower in heading_lower:
            return score
    return None


def build_briefing_note(data, styles, accent_color=None):
    """Build Briefing Note section (J)."""
    accent = accent_color or BLUE
    bn = data.get('briefingNote')
    if not bn:
        return []

    elements = []
    donor_name = data.get('donorName', '')

    # Section title header
    elements.append(SectionTitleFlowable('Briefing Note', donor_name, CONTENT_WIDTH, styles))
    elements.append(Spacer(1, 8))

    sections = bn.get('sections', [])
    for i, section in enumerate(sections):
        heading_elements = _build_section_heading(section['title'], styles, is_first=(i == 0))

        paragraphs = section.get('paragraphs', [])
        first_content = None
        if paragraphs:
            p0 = paragraphs[0]
            c0 = _md_inline_to_html(p0.get('content', ''))
            if p0.get('type') == 'bullet':
                first_content = Paragraph(
                    f'<font color="{BULLET_GRAY.hexval()}">\u2022</font>  {c0}',
                    styles['bullet']
                )
            else:
                first_content = Paragraph(c0, styles['body'])

        if first_content:
            elements.append(KeepTogether(heading_elements + [first_content]))
        else:
            elements.extend(heading_elements)

        for para in paragraphs[1:]:
            ptype = para.get('type', 'text')
            content = _md_inline_to_html(para.get('content', ''))

            if ptype == 'bullet':
                elements.append(Paragraph(
                    f'<font color="{BULLET_GRAY.hexval()}">\u2022</font>  {content}',
                    styles['bullet']
                ))
            else:
                elements.append(Paragraph(content, styles['body']))

    return elements


def build_persuasion_profile(data, styles, accent_color=None):
    """Build persuasion profile content pages (M, K, N)."""
    accent = accent_color or PURPLE_LIGHT
    elements = []

    donor_name = data.get('donorName', '')
    elements.append(SectionTitleFlowable('Persuasion Profile', donor_name, CONTENT_WIDTH, styles))
    elements.append(Spacer(1, 8))

    sections = data.get('persuasionProfile', {}).get('sections', [])
    confidence_scores = data.get('confidenceScores', {})

    for i, section in enumerate(sections):
        heading_elements = _build_section_heading(
            section['title'], styles,
            confidence_scores=confidence_scores,
            is_first=(i == 0)
        )

        paragraphs = section.get('paragraphs', [])
        first_content = None
        if paragraphs:
            p0 = paragraphs[0]
            c0 = _md_inline_to_html(p0.get('content', ''))
            t0 = p0.get('type', 'text')
            if t0 == 'insight':
                first_content = _build_insight_box(c0, accent, styles)
            elif t0 == 'bold':
                first_content = Paragraph(c0, styles['body_bold'])
            elif t0 == 'bullet':
                first_content = Paragraph(
                    f'<font color="{BULLET_GRAY.hexval()}">\u2022</font>  {c0}',
                    styles['profile_bullet']
                )
            else:
                first_content = Paragraph(c0, styles['body'])

        # Add spacing after confidence badge
        heading_elements.append(Spacer(1, 6))

        if first_content:
            elements.append(KeepTogether(heading_elements + [first_content]))
        else:
            elements.extend(heading_elements)

        for para in paragraphs[1:]:
            ptype = para.get('type', 'text')
            content = _md_inline_to_html(para.get('content', ''))

            if ptype == 'insight':
                elements.append(Spacer(1, 4))
                elements.append(_build_insight_box(content, accent, styles))
                elements.append(Spacer(1, 4))
            elif ptype == 'bold':
                elements.append(Paragraph(content, styles['body_bold']))
            elif ptype == 'bullet':
                elements.append(Paragraph(
                    f'<font color="{BULLET_GRAY.hexval()}">\u2022</font>  {content}',
                    styles['profile_bullet']
                ))
            else:
                elements.append(Paragraph(content, styles['body']))

    return elements


def build_meeting_guide(data, styles, accent_color=None):
    """Build meeting guide content pages."""
    accent = accent_color or GREEN_LIGHT
    mg = data.get('meetingGuide', {})
    donor_name = data.get('donorName', '')

    if mg.get('format') == 'v3':
        return _build_meeting_guide_v3(mg, styles, accent, donor_name)

    return _build_meeting_guide_legacy(mg, styles, accent, donor_name)


def _build_meeting_guide_v3(mg, styles, accent_color=None, donor_name=''):
    """Build v3 meeting guide: Setup, The Arc, Tripwires, One Line (M, N)."""
    accent = accent_color or GREEN_LIGHT
    elements = []

    name = mg.get('donorName', '') or donor_name
    elements.append(SectionTitleFlowable('Meeting Guide', name, CONTENT_WIDTH, styles))
    elements.append(Spacer(1, 8))

    # Setup section
    setup_groups = mg.get('setupGroups', [])
    if setup_groups:
        elements.extend(_build_section_heading('Setup', styles, is_first=True))
        for group in setup_groups:
            elements.append(Spacer(1, 6))
            # Sub-heading (F)
            elements.append(Paragraph(
                _md_inline_to_html(group.get('heading', '')),
                styles['subheading']
            ))
            for bullet in group.get('bullets', []):
                elements.append(Paragraph(
                    f'<font color="{BULLET_GRAY.hexval()}">\u2022</font>  {_md_inline_to_html(bullet)}',
                    styles['bullet']
                ))

    # The Arc section (beats)
    beats = mg.get('beats', [])
    if beats:
        elements.extend(_build_section_heading('The Arc', styles))

        for beat in beats:
            # Build beat header group (keep title + goal + first phase together)
            beat_header = [Spacer(1, 10)]
            title_text = f"<b>Beat {beat.get('number', '')}:</b> {_md_inline_to_html(beat.get('title', ''))}"
            beat_header.append(Paragraph(title_text, styles['card_title']))
            if beat.get('goal'):
                beat_header.append(Paragraph(
                    f"<i>{_md_inline_to_html(beat['goal'])}</i>",
                    styles['body_italic']
                ))
            beat_header.append(Spacer(1, 4))

            # Build phase boxes
            phase_elements = []

            if beat.get('start') or beat.get('startBullets'):
                start_content = []
                if beat.get('start'):
                    start_content.append(('text', _md_inline_to_html(beat['start'])))
                for b in beat.get('startBullets', []):
                    start_content.append(('bullet', _md_inline_to_html(b)))
                phase_elements.append(_build_phase_box('START', start_content, styles))

            if beat.get('stay') or beat.get('stayParagraphs') or beat.get('stayBullets'):
                stay_content = []
                if beat.get('stay'):
                    stay_text = _md_inline_to_html(beat['stay'])
                    stay_text = stay_text.replace('\n\n', '<br/><br/>')
                    stay_content.append(('text', stay_text))
                for p in beat.get('stayParagraphs', []):
                    stay_content.append(('text', _md_inline_to_html(p)))
                for b in beat.get('stayBullets', []):
                    stay_content.append(('bullet', _md_inline_to_html(b)))
                if beat.get('stallingText'):
                    stay_content.append(('text',
                        f"<b>Stalling:</b> {_md_inline_to_html(beat['stallingText'])}"))
                phase_elements.append(_build_phase_box('STAY', stay_content, styles))

            if beat.get('continue') or beat.get('continueBullets'):
                cont_content = []
                if beat.get('continue'):
                    cont_content.append(('text', _md_inline_to_html(beat['continue'])))
                for b in beat.get('continueBullets', []):
                    cont_content.append(('bullet', _md_inline_to_html(b)))
                phase_elements.append(_build_phase_box('CONTINUE', cont_content, styles))

            # Keep beat header together, then add phases
            elements.append(KeepTogether(beat_header))
            elements.extend(phase_elements)

    # Tripwires section
    tripwires = mg.get('tripwires', [])
    if tripwires:
        elements.extend(_build_section_heading('Tripwires', styles))

        for tw in tripwires:
            elements.append(Spacer(1, 6))
            elements.append(_build_tripwire_card(
                tw.get('name', ''),
                tw.get('tell', ''),
                tw.get('recovery', ''),
                styles
            ))

    # One Line removed — now on cover page

    return elements


def _build_meeting_guide_legacy(mg, styles, accent_color=None, donor_name=''):
    """Build legacy meeting guide content pages."""
    accent = accent_color or GREEN_LIGHT
    elements = []

    name = mg.get('donorName', '') or donor_name
    elements.append(SectionTitleFlowable('Meeting Guide', name, CONTENT_WIDTH, styles))
    elements.append(Spacer(1, 8))

    first_section = True

    if mg.get('donorRead'):
        elements.extend(_build_section_heading('The Donor Read', styles, is_first=first_section))
        first_section = False
        if mg['donorRead'].get('posture'):
            elements.append(Paragraph(
                _md_inline_to_html(mg['donorRead']['posture']), styles['body_bold']
            ))
        for body in mg['donorRead'].get('body', []):
            elements.append(Paragraph(_md_inline_to_html(body), styles['body']))

    if mg.get('lightsUp'):
        elements.extend(_build_section_heading('What Lights Them Up', styles, is_first=first_section))
        first_section = False
        for item in mg['lightsUp']:
            elements.append(Paragraph(
                f"<b>{_md_inline_to_html(item.get('title', ''))}</b>", styles['body_bold']
            ))
            elements.append(Paragraph(_md_inline_to_html(item.get('body', '')), styles['body']))

    if mg.get('shutsDown'):
        elements.extend(_build_section_heading('What Shuts Them Down', styles, is_first=first_section))
        first_section = False
        for item in mg['shutsDown']:
            elements.append(Paragraph(
                f'<font color="{BULLET_GRAY.hexval()}">\u2022</font>  {_md_inline_to_html(item)}',
                styles['bullet']
            ))

    if mg.get('meetingArc'):
        arc = mg['meetingArc']
        elements.extend(_build_section_heading('Meeting Arc', styles, is_first=first_section))
        first_section = False
        if arc.get('intro'):
            elements.append(Paragraph(_md_inline_to_html(arc['intro']), styles['body']))
        for move in arc.get('moves', []):
            elements.append(Spacer(1, 8))
            elements.append(_build_move_card(move, accent, styles))

    if mg.get('readingRoom'):
        rr = mg['readingRoom']
        elements.extend(_build_section_heading('Reading the Room', styles, is_first=first_section))
        first_section = False
        elements.append(_build_two_columns(
            rr.get('working', []), rr.get('stalling', []), styles
        ))

    if mg.get('resetMoves'):
        elements.extend(_build_section_heading('Reset Moves', styles, is_first=first_section))
        first_section = False
        for item in mg['resetMoves']:
            elements.append(Paragraph(
                f'<font color="{BULLET_GRAY.hexval()}">\u2022</font>  {_md_inline_to_html(item)}',
                styles['bullet']
            ))

    return elements


def build_sources(data, styles, accent_color=None):
    """Build sources list pages (L)."""
    accent = accent_color or CORAL
    elements = []
    sources = data.get('sources', [])

    if not sources:
        elements.extend(_build_section_heading('Sources', styles, is_first=True))
        elements.append(Paragraph('Sources unavailable', styles['body']))
        return elements

    elements.extend(
        _build_section_heading(f'{len(sources)} Research Sources', styles, is_first=True)
    )
    elements.append(Spacer(1, 8))

    max_display = 50
    for i, source in enumerate(sources[:max_display]):
        title = source.get('title', source.get('url', ''))
        url = source.get('url', '')

        elements.append(Paragraph(
            f'<b>{i + 1}.</b>  {_escape_xml(title)}',
            styles['source_title']
        ))
        if url:
            elements.append(Paragraph(
                _escape_xml(url),
                styles['source_domain']
            ))
        elements.append(Spacer(1, 10))

    if len(sources) > max_display:
        elements.append(Spacer(1, 8))
        elements.append(Paragraph(
            f'+ {len(sources) - max_display} additional sources',
            styles['source_domain']
        ))

    return elements


# ─── Inline flowable builders ─────────────────────────────────────────────────

def _build_insight_box(text, accent_color, styles):
    """Build an insight callout box."""
    class InsightBoxFlowable(Flowable):
        def __init__(self, text, accent, width):
            super().__init__()
            self.text = text
            self.accent = accent
            self.box_width = width
            self._para = None
            self._h = 0

        def wrap(self, aW, aH):
            style = ParagraphStyle(
                'ib', fontName='DMSans-Italic',
                fontSize=10.5, leading=18, textColor=BODY_TEXT,
            )
            inner = self.box_width - 24
            self._para = Paragraph(self.text, style)
            w, h = self._para.wrap(inner, aH)
            self._h = h + 16
            return (self.box_width, self._h)

        def draw(self):
            c = self.canv
            c.setFillColor(PARCHMENT)
            c.roundRect(0, 0, self.box_width, self._h, 4, stroke=0, fill=1)
            c.setFillColor(self.accent)
            c.rect(0, 0, 3.5, self._h, stroke=0, fill=1)
            if self._para:
                self._para.drawOn(c, 16, 8)

    return InsightBoxFlowable(text, accent_color, CONTENT_WIDTH)


def _build_move_card(move, accent_color, styles):
    """Build a meeting move card."""
    class MoveCardFlowable(Flowable):
        def __init__(self, move_data, accent, width):
            super().__init__()
            self.move_data = move_data
            self.accent = accent
            self.card_width = width
            self._h = 0
            self._title_p = None
            self._move_p = None
            self._read_p = None

        def wrap(self, aW, aH):
            inner = self.card_width - 32
            ts = ParagraphStyle('mt', fontName='DMSans-Bold', fontSize=11, leading=15, textColor=CHARCOAL)
            self._title_p = Paragraph(
                f"{self.move_data.get('number', '')}. {_md_inline_to_html(self.move_data.get('title', ''))}",
                ts
            )
            _, th = self._title_p.wrap(inner, aH)

            ms = ParagraphStyle('mm', fontName='DMSans', fontSize=9, leading=13, textColor=BODY_TEXT)
            self._move_p = Paragraph(_md_inline_to_html(self.move_data.get('moveText', '')), ms)
            _, mh = self._move_p.wrap(inner, aH)

            rs = ParagraphStyle('mr', fontName='DMSans-Italic', fontSize=9, leading=13, textColor=BODY_TEXT)
            self._read_p = Paragraph(_md_inline_to_html(self.move_data.get('readText', '')), rs)
            _, rh = self._read_p.wrap(inner, aH)

            self._h = 3 + 14 + th + 8 + mh + 12 + 1 + 12 + 12 + rh + 14
            return (self.card_width, self._h)

        def draw(self):
            c = self.canv
            w = self.card_width
            h = self._h

            c.setStrokeColor(STONE)
            c.setLineWidth(0.5)
            c.setFillColor(WHITE)
            c.roundRect(0, 0, w, h, 4, stroke=1, fill=1)

            c.setFillColor(self.accent)
            c.rect(0, h - 3, w, 3, stroke=0, fill=1)

            y = h - 3 - 14
            if self._title_p:
                _, th = self._title_p.wrap(w - 32, 1000)
                self._title_p.drawOn(c, 16, y - th)
                y -= th + 8

            if self._move_p:
                _, mh = self._move_p.wrap(w - 32, 1000)
                self._move_p.drawOn(c, 16, y - mh)
                y -= mh + 12

            c.setStrokeColor(STONE)
            c.setLineWidth(0.5)
            c.line(16, y, w - 16, y)
            y -= 12

            sans_bold = 'DMSans-Bold' if 'DMSans-Bold' in c.getAvailableFonts() else 'Helvetica-Bold'
            c.setFont(sans_bold, 7.5)
            c.setFillColor(LIGHT_GRAY)
            c.drawString(16, y, 'THE READ')
            y -= 14

            if self._read_p:
                _, rh = self._read_p.wrap(w - 32, 1000)
                self._read_p.drawOn(c, 16, y - rh)

    return MoveCardFlowable(move, accent_color, CONTENT_WIDTH)


def _build_two_columns(working, stalling, styles):
    """Build two-column Working/Stalling signals."""
    class TwoColFlowable(Flowable):
        def __init__(self, working_items, stalling_items, width):
            super().__init__()
            self.working = working_items
            self.stalling = stalling_items
            self.box_width = width
            self._h = 0

        def wrap(self, aW, aH):
            max_items = max(len(self.working), len(self.stalling), 1)
            self._h = 28 + max_items * 16 + 12
            return (self.box_width, self._h)

        def draw(self):
            c = self.canv
            w = self.box_width
            h = self._h
            col_w = (w - 12) / 2

            c.setFillColor(HexColor('#E8F5E9'))
            c.roundRect(0, 0, col_w, h, 4, stroke=0, fill=1)
            c.setFillColor(HexColor('#FBE9E7'))
            c.roundRect(col_w + 12, 0, col_w, h, 4, stroke=0, fill=1)

            sans_bold = 'DMSans-Bold' if 'DMSans-Bold' in c.getAvailableFonts() else 'Helvetica-Bold'
            sans = 'DMSans' if 'DMSans' in c.getAvailableFonts() else 'Helvetica'

            c.setFont(sans_bold, 8)
            c.setFillColor(GREEN)
            c.drawString(10, h - 18, 'WORKING')
            c.setFillColor(CORAL)
            c.drawString(col_w + 22, h - 18, 'STALLING')

            c.setFont(sans, 8)
            y = h - 34
            c.setFillColor(HexColor('#2D6A4F'))
            for item in self.working:
                text = f'\u2713  {item}'[:55]
                c.drawString(10, y, text)
                y -= 16

            y = h - 34
            c.setFillColor(HexColor('#E07A5F'))
            for item in self.stalling:
                text = f'\u2717  {item}'[:55]
                c.drawString(col_w + 22, y, text)
                y -= 16

    return TwoColFlowable(working, stalling, CONTENT_WIDTH)


# ─── Markdown text helpers ────────────────────────────────────────────────────

def _escape_xml(text):
    """Escape XML special characters for ReportLab paragraphs."""
    if not text:
        return ''
    return (text
            .replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;')
            .replace('"', '&quot;'))


def _md_inline_to_html(text):
    """Convert markdown bold/italic to HTML tags for ReportLab."""
    if not text:
        return ''
    text = _escape_xml(text)
    text = re.sub(r'\*\*\*(.+?)\*\*\*', r'<b><i>\1</i></b>', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'\*(.+?)\*', r'<i>\1</i>', text)
    return text


# ─── Main PDF builder ─────────────────────────────────────────────────────────

def generate_pdf(data, output_path):
    """Generate a PDF from structured profile data."""
    fonts = register_fonts()
    styles = make_styles(fonts)

    doc = BaseDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN + 10,
        bottomMargin=MARGIN,
        title=f"{data['donorName']} — ProspectAI Donor Intelligence",
        author='ProspectAI',
    )

    dark_frame = Frame(MARGIN, MARGIN, CONTENT_WIDTH, PAGE_HEIGHT - 2 * MARGIN,
                       id='dark_frame', showBoundary=0)
    content_frame = Frame(MARGIN, MARGIN + 10, CONTENT_WIDTH, PAGE_HEIGHT - 2 * MARGIN - 20,
                          id='content_frame', showBoundary=0)

    dark_template = PageTemplate(id='dark', frames=[dark_frame], onPage=draw_dark_page)
    content_template = PageTemplate(id='content', frames=[content_frame], onPage=draw_content_page)

    doc.addPageTemplates([dark_template, content_template])

    story = []

    # ─── Cover page (dark) ───
    story.extend(build_cover_page(data, styles))

    # ─── Switch to content pages ───
    story.append(NextPageTemplate('content'))
    story.append(PageBreak())

    # ─── Briefing Note (J) ───
    if data.get('briefingNote'):
        story.append(AccentLineFlowable(SECTION_ACCENT['briefing_note']))
        story.extend(build_briefing_note(data, styles))
        story.append(PageBreak())

    # ─── Persuasion Profile ───
    story.append(AccentLineFlowable(SECTION_ACCENT['persuasion_profile']))
    story.extend(build_persuasion_profile(data, styles))

    # ─── Meeting Guide ───
    if data.get('meetingGuide') and (
        data['meetingGuide'].get('format') == 'v3' or
        data['meetingGuide'].get('donorRead') or
        data['meetingGuide'].get('meetingArc') or
        data['meetingGuide'].get('lightsUp')
    ):
        story.append(PageBreak())
        story.append(AccentLineFlowable(SECTION_ACCENT['meeting_guide']))
        story.extend(build_meeting_guide(data, styles))

    # ─── Sources (L) ───
    story.append(PageBreak())
    story.append(AccentLineFlowable(SECTION_ACCENT['sources']))
    story.extend(build_sources(data, styles))

    doc.build(story)
    print(f'[PDF] Generated: {output_path}')


# ─── CLI entry point ──────────────────────────────────────────────────────────

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('Usage: python3 generator.py <input.json> <output.pdf>')
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    with open(input_path, 'r') as f:
        data = json.load(f)

    generate_pdf(data, output_path)
