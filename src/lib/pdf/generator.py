#!/usr/bin/env python3
"""
ProspectAI PDF Generator — DTW Design System

Generates a professionally designed PDF from profile JSON data.
Content-agnostic layout engine that applies the DTW design system
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

# ─── Design tokens (inline to avoid import issues when run as script) ─────

CHARCOAL     = HexColor('#1A1A1A')
WARM_WHITE   = HexColor('#FAF8F5')
PARCHMENT    = HexColor('#F5F3EF')
STONE        = HexColor('#E8E5E0')
BODY_TEXT    = HexColor('#4A4A4A')
LIGHT_GRAY   = HexColor('#9A9A9A')
WHITE        = HexColor('#FFFFFF')
PURPLE       = HexColor('#7B2D8E')
PURPLE_LIGHT = HexColor('#D894E8')
GREEN        = HexColor('#2D6A4F')
GREEN_LIGHT  = HexColor('#40916C')
CORAL        = HexColor('#E07A5F')

GRADIENT_STOPS = [
    (0.0, PURPLE),
    (0.33, GREEN),
    (0.66, CORAL),
    (1.0, PURPLE),
]

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
            # Fallback: register with regular if available
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
        'cover_meta_label': ParagraphStyle(
            'cover_meta_label', fontName=sans, fontSize=9,
            leading=20, textColor=Color(1, 1, 1, 0.4), alignment=TA_LEFT,
        ),
        'cover_meta_value': ParagraphStyle(
            'cover_meta_value', fontName=sans, fontSize=9,
            leading=20, textColor=Color(1, 1, 1, 0.7), alignment=TA_LEFT,
        ),
        'cover_footer': ParagraphStyle(
            'cover_footer', fontName=sans, fontSize=7.5,
            leading=11, textColor=Color(1, 1, 1, 0.25), alignment=TA_CENTER,
        ),

        # Section cover pages
        'section_overline': ParagraphStyle(
            'section_overline', fontName=sans, fontSize=9,
            leading=14, textColor=PURPLE_LIGHT, alignment=TA_LEFT,
            spaceAfter=12,
        ),
        'section_title': ParagraphStyle(
            'section_title', fontName=serif, fontSize=44,
            leading=50, textColor=WHITE, alignment=TA_LEFT,
            spaceAfter=12,
        ),
        'section_desc': ParagraphStyle(
            'section_desc', fontName=sans_light, fontSize=11,
            leading=16, textColor=Color(1, 1, 1, 0.4), alignment=TA_LEFT,
        ),

        # Content pages
        'heading': ParagraphStyle(
            'heading', fontName=serif, fontSize=18,
            leading=24, textColor=CHARCOAL, alignment=TA_LEFT,
            spaceBefore=20, spaceAfter=8,
        ),
        'subheading': ParagraphStyle(
            'subheading', fontName=sans_bold, fontSize=13,
            leading=18, textColor=CHARCOAL, alignment=TA_LEFT,
            spaceBefore=14, spaceAfter=6,
        ),
        'body': ParagraphStyle(
            'body', fontName=sans, fontSize=9.5,
            leading=14, textColor=BODY_TEXT, alignment=TA_JUSTIFY,
            spaceAfter=6,
        ),
        'body_bold': ParagraphStyle(
            'body_bold', fontName=sans_bold, fontSize=9.5,
            leading=14, textColor=CHARCOAL, alignment=TA_JUSTIFY,
            spaceAfter=6,
        ),
        'body_italic': ParagraphStyle(
            'body_italic', fontName=sans_italic, fontSize=9.5,
            leading=14, textColor=BODY_TEXT, alignment=TA_JUSTIFY,
            spaceAfter=6,
        ),
        'insight': ParagraphStyle(
            'insight', fontName=sans_italic, fontSize=9.5,
            leading=14, textColor=BODY_TEXT, alignment=TA_LEFT,
        ),
        'bullet': ParagraphStyle(
            'bullet', fontName=sans, fontSize=9.5,
            leading=14, textColor=BODY_TEXT, alignment=TA_LEFT,
            leftIndent=16, bulletIndent=4, spaceAfter=3,
        ),

        # Footer
        'footer_left': ParagraphStyle(
            'footer_left', fontName=sans, fontSize=7.5,
            leading=10, textColor=LIGHT_GRAY, alignment=TA_LEFT,
        ),
        'footer_right': ParagraphStyle(
            'footer_right', fontName=sans, fontSize=7.5,
            leading=10, textColor=LIGHT_GRAY, alignment=TA_RIGHT,
        ),

        # Sources
        'source_num': ParagraphStyle(
            'source_num', fontName=sans_bold, fontSize=8,
            leading=12, textColor=PURPLE, alignment=TA_LEFT,
        ),
        'source_title': ParagraphStyle(
            'source_title', fontName=sans, fontSize=7.5,
            leading=11, textColor=CHARCOAL, alignment=TA_LEFT,
        ),
        'source_domain': ParagraphStyle(
            'source_domain', fontName=sans_light, fontSize=6.5,
            leading=10, textColor=LIGHT_GRAY, alignment=TA_LEFT,
        ),

        # Card styles
        'card_title': ParagraphStyle(
            'card_title', fontName=sans_bold, fontSize=11,
            leading=15, textColor=CHARCOAL, alignment=TA_LEFT,
        ),
        'card_body': ParagraphStyle(
            'card_body', fontName=sans, fontSize=9,
            leading=13, textColor=BODY_TEXT, alignment=TA_LEFT,
        ),
        'card_read': ParagraphStyle(
            'card_read', fontName=sans_italic, fontSize=9,
            leading=13, textColor=BODY_TEXT, alignment=TA_LEFT,
        ),
        'card_label': ParagraphStyle(
            'card_label', fontName=sans_bold, fontSize=7.5,
            leading=10, textColor=LIGHT_GRAY, alignment=TA_LEFT,
        ),

        # Two-column
        'signal_header': ParagraphStyle(
            'signal_header', fontName=sans_bold, fontSize=8,
            leading=12, textColor=GREEN, alignment=TA_LEFT,
        ),
        'signal_item': ParagraphStyle(
            'signal_item', fontName=sans, fontSize=8.5,
            leading=13, textColor=BODY_TEXT, alignment=TA_LEFT,
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

    # Subtle radial glows (approximated with circles)
    canvas.setFillColor(Color(0.482, 0.176, 0.557, 0.08))  # purple glow
    canvas.circle(PAGE_WIDTH * 0.75, PAGE_HEIGHT * 0.7, 200, stroke=0, fill=1)
    canvas.setFillColor(Color(0.176, 0.416, 0.310, 0.06))  # green glow
    canvas.circle(PAGE_WIDTH * 0.25, PAGE_HEIGHT * 0.3, 180, stroke=0, fill=1)

    canvas.restoreState()


def draw_content_page(canvas, doc):
    """Background for content pages — warm white with thin gradient bar."""
    canvas.saveState()
    canvas.setFillColor(WARM_WHITE)
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)

    # Thin gradient bar at top
    draw_gradient_bar(canvas, 0, PAGE_HEIGHT - 3, PAGE_WIDTH, 3)

    # Footer
    canvas.setStrokeColor(STONE)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, 36, PAGE_WIDTH - MARGIN, 36)

    canvas.setFont('DMSans' if 'DMSans' in canvas.getAvailableFonts() else 'Helvetica', 7.5)
    canvas.setFillColor(LIGHT_GRAY)
    canvas.drawString(MARGIN, 24, 'ProspectAI \u00b7 Confidential')
    canvas.drawRightString(PAGE_WIDTH - MARGIN, 24, str(canvas.getPageNumber()))

    canvas.restoreState()


# ─── Content builders ─────────────────────────────────────────────────────────

def build_cover_page(data, styles):
    """Build cover page flowables."""
    elements = []
    elements.append(Spacer(1, PAGE_HEIGHT * 0.35))

    # Overline
    overline = 'P R O S P E C T A I   D O N O R   I N T E L L I G E N C E'
    elements.append(Paragraph(overline, styles['cover_overline']))

    # Donor name
    elements.append(Paragraph(data['donorName'], styles['cover_name']))

    # Subtitle
    elements.append(Paragraph('Behavioral Profile &amp; Meeting Strategy', styles['cover_subtitle']))

    # Meta table
    meta_items = []
    if data.get('preparedFor'):
        meta_items.append(f"<b>Prepared for</b>  {data['preparedFor']}")
    meta_items.append(f"<b>Date</b>  {data.get('date', '')}")
    meta_items.append(f"<b>Classification</b>  Confidential \u2014 Internal Use Only")
    meta_items.append(f"<b>Sources</b>  {data.get('sourceCount', 0)} verified references")

    for item in meta_items:
        elements.append(Paragraph(item, styles['cover_meta_value']))

    # Footer at bottom
    elements.append(Spacer(1, 80))
    elements.append(Paragraph(
        'Generated by ProspectAI \u00b7 Confidential \u00b7 Internal Use Only',
        styles['cover_footer']
    ))
    elements.append(Paragraph('Democracy Takes Work', styles['cover_footer']))

    elements.append(PageBreak())
    return elements


def build_section_cover(section_num, title, description, accent_color, styles):
    """Build a section cover page."""
    elements = []
    elements.append(Spacer(1, PAGE_HEIGHT * 0.38))

    overline_style = ParagraphStyle(
        f'section_overline_{section_num}',
        parent=styles['section_overline'],
        textColor=accent_color if accent_color != GREEN else GREEN_LIGHT,
    )
    overline_text = f'S E C T I O N   {section_num}'
    elements.append(Paragraph(overline_text, overline_style))
    elements.append(Paragraph(title, styles['section_title']))
    elements.append(Paragraph(description, styles['section_desc']))
    elements.append(PageBreak())
    return elements


def build_persuasion_profile(data, styles, accent_color=PURPLE):
    """Build persuasion profile content pages from sections array."""
    elements = []
    sections = data.get('persuasionProfile', {}).get('sections', [])

    for i, section in enumerate(sections):
        # Accent line before each heading
        class AccentLineFlowable(Flowable):
            def __init__(self, color):
                super().__init__()
                self.color = color
            def wrap(self, aW, aH):
                return (40, 10)
            def draw(self):
                self.canv.setFillColor(self.color)
                self.canv.rect(0, 4, 40, 2, stroke=0, fill=1)

        if i > 0:
            elements.append(Spacer(1, 12))

        elements.append(AccentLineFlowable(accent_color))
        elements.append(Paragraph(section['title'], styles['heading']))

        for para in section.get('paragraphs', []):
            ptype = para.get('type', 'text')
            content = para.get('content', '')

            # Convert markdown bold/italic to HTML tags
            content = _md_inline_to_html(content)

            if ptype == 'insight':
                # Insight callout box
                elements.append(Spacer(1, 4))
                elements.append(_build_insight_box(content, accent_color, styles))
                elements.append(Spacer(1, 4))
            elif ptype == 'bold':
                elements.append(Paragraph(content, styles['body_bold']))
            else:
                elements.append(Paragraph(content, styles['body']))

    return elements


def build_meeting_guide(data, styles, accent_color=GREEN):
    """Build meeting guide content pages. Supports v3 and legacy formats."""
    mg = data.get('meetingGuide', {})

    # Detect v3 format
    if mg.get('format') == 'v3':
        return _build_meeting_guide_v3(mg, styles, accent_color)

    return _build_meeting_guide_legacy(mg, styles, accent_color)


def _build_meeting_guide_v3(mg, styles, accent_color=GREEN):
    """Build v3 meeting guide: Setup, The Arc (beats with START/STAY/CONTINUE), Tripwires, One Line."""
    elements = []

    class AccentLineFlowable2(Flowable):
        def __init__(self, color):
            super().__init__()
            self.color = color
        def wrap(self, aW, aH):
            return (40, 10)
        def draw(self):
            self.canv.setFillColor(self.color)
            self.canv.rect(0, 4, 40, 2, stroke=0, fill=1)

    # Setup section
    setup_groups = mg.get('setupGroups', [])
    if setup_groups:
        elements.append(AccentLineFlowable2(accent_color))
        elements.append(Paragraph('Setup', styles['heading']))
        for group in setup_groups:
            elements.append(Spacer(1, 6))
            elements.append(Paragraph(
                f"<b>{_md_inline_to_html(group.get('heading', ''))}</b>",
                styles['body_bold']
            ))
            for bullet in group.get('bullets', []):
                elements.append(Paragraph(
                    f'\u2014  {_md_inline_to_html(bullet)}', styles['bullet']
                ))

    # The Arc section (beats)
    beats = mg.get('beats', [])
    if beats:
        elements.append(Spacer(1, 16))
        elements.append(AccentLineFlowable2(accent_color))
        elements.append(Paragraph('The Arc', styles['heading']))

        for beat in beats:
            elements.append(Spacer(1, 10))
            # Beat header
            title_text = f"<b>Beat {beat.get('number', '')}:</b> {_md_inline_to_html(beat.get('title', ''))}"
            elements.append(Paragraph(title_text, styles['card_title']))
            if beat.get('goal'):
                elements.append(Paragraph(
                    f"<i>{_md_inline_to_html(beat['goal'])}</i>",
                    styles['body_italic']
                ))
            elements.append(Spacer(1, 4))

            # START phase
            if beat.get('start'):
                elements.append(Paragraph(
                    f"<b>START.</b> {_md_inline_to_html(beat['start'])}",
                    styles['body']
                ))

            # STAY phase
            if beat.get('stay'):
                stay_text = beat['stay'].replace('\n\n', '<br/><br/>')
                elements.append(Paragraph(
                    f"<b>STAY.</b> {_md_inline_to_html(stay_text)}",
                    styles['body']
                ))

            # Stalling indicator
            if beat.get('stallingText'):
                elements.append(Spacer(1, 2))
                elements.append(_build_insight_box(
                    f"<b>Stalling:</b> {_md_inline_to_html(beat['stallingText'])}",
                    CORAL, styles
                ))

            # CONTINUE phase
            if beat.get('continue'):
                elements.append(Paragraph(
                    f"<b>CONTINUE.</b> {_md_inline_to_html(beat['continue'])}",
                    styles['body']
                ))

    # Tripwires section
    tripwires = mg.get('tripwires', [])
    if tripwires:
        elements.append(Spacer(1, 16))
        elements.append(AccentLineFlowable2(CORAL))
        elements.append(Paragraph('Tripwires', styles['heading']))

        for tw in tripwires:
            elements.append(Spacer(1, 6))
            elements.append(Paragraph(
                f"<b>{_md_inline_to_html(tw.get('name', ''))}.</b>",
                styles['body_bold']
            ))
            if tw.get('tell'):
                elements.append(Paragraph(
                    f"<i>Tell:</i> {_md_inline_to_html(tw['tell'])}",
                    styles['body']
                ))
            if tw.get('recovery'):
                elements.append(Paragraph(
                    f"<i>Recovery:</i> {_md_inline_to_html(tw['recovery'])}",
                    styles['body']
                ))

    # One Line section
    one_line = mg.get('oneLine', '')
    if one_line:
        elements.append(Spacer(1, 16))
        elements.append(AccentLineFlowable2(accent_color))
        elements.append(Paragraph('One Line', styles['heading']))
        elements.append(Spacer(1, 4))
        elements.append(_build_insight_box(
            f"<i>{_md_inline_to_html(one_line)}</i>",
            accent_color, styles
        ))

    return elements


def _build_meeting_guide_legacy(mg, styles, accent_color=GREEN):
    """Build legacy meeting guide content pages."""
    elements = []

    class AccentLineFlowable2(Flowable):
        def __init__(self, color):
            super().__init__()
            self.color = color
        def wrap(self, aW, aH):
            return (40, 10)
        def draw(self):
            self.canv.setFillColor(self.color)
            self.canv.rect(0, 4, 40, 2, stroke=0, fill=1)

    # Donor Read
    if mg.get('donorRead'):
        elements.append(AccentLineFlowable2(accent_color))
        elements.append(Paragraph('The Donor Read', styles['heading']))
        if mg['donorRead'].get('posture'):
            elements.append(Paragraph(
                _md_inline_to_html(mg['donorRead']['posture']),
                styles['body_bold']
            ))
        for body in mg['donorRead'].get('body', []):
            elements.append(Paragraph(_md_inline_to_html(body), styles['body']))

    # Lights Up
    if mg.get('lightsUp'):
        elements.append(Spacer(1, 12))
        elements.append(AccentLineFlowable2(accent_color))
        elements.append(Paragraph('What Lights Them Up', styles['heading']))
        for item in mg['lightsUp']:
            elements.append(Paragraph(
                f"<b>{_md_inline_to_html(item.get('title', ''))}</b>",
                styles['body_bold']
            ))
            elements.append(Paragraph(_md_inline_to_html(item.get('body', '')), styles['body']))

    # Shuts Down
    if mg.get('shutsDown'):
        elements.append(Spacer(1, 12))
        elements.append(AccentLineFlowable2(CORAL))
        elements.append(Paragraph('What Shuts Them Down', styles['heading']))
        for item in mg['shutsDown']:
            elements.append(Paragraph(f'\u2022  {_md_inline_to_html(item)}', styles['bullet']))

    # Alignment Map
    if mg.get('alignmentMap'):
        am = mg['alignmentMap']
        elements.append(Spacer(1, 12))
        elements.append(AccentLineFlowable2(accent_color))
        elements.append(Paragraph('Alignment Map', styles['heading']))

        if am.get('primary'):
            elements.append(Paragraph(
                f"<b>{_md_inline_to_html(am['primary'].get('title', ''))}</b>",
                styles['body_bold']
            ))
            elements.append(Paragraph(
                _md_inline_to_html(am['primary'].get('body', '')), styles['body']
            ))

        for sec in am.get('secondary', []):
            elements.append(Paragraph(
                f"<b>{_md_inline_to_html(sec.get('title', ''))}</b>",
                styles['body_bold']
            ))
            elements.append(Paragraph(
                _md_inline_to_html(sec.get('body', '')), styles['body']
            ))

        for key in ['fightOrBuild', 'handsOnWheel']:
            if am.get(key):
                elements.append(Spacer(1, 4))
                elements.append(_build_insight_box(
                    _md_inline_to_html(am[key]), accent_color, styles
                ))

        if am.get('fiveMinCollapse'):
            elements.append(Spacer(1, 8))
            elements.append(_build_insight_box(
                '<b>5 MIN COLLAPSE:</b> ' + _md_inline_to_html(am['fiveMinCollapse']),
                CORAL, styles
            ))

    # Meeting Arc
    if mg.get('meetingArc'):
        arc = mg['meetingArc']
        elements.append(Spacer(1, 12))
        elements.append(AccentLineFlowable2(accent_color))
        elements.append(Paragraph('Meeting Arc', styles['heading']))

        if arc.get('intro'):
            elements.append(Paragraph(_md_inline_to_html(arc['intro']), styles['body']))

        for move in arc.get('moves', []):
            elements.append(Spacer(1, 8))
            elements.append(_build_move_card(move, accent_color, styles))

    # Reading the Room
    if mg.get('readingRoom'):
        rr = mg['readingRoom']
        elements.append(Spacer(1, 12))
        elements.append(AccentLineFlowable2(accent_color))
        elements.append(Paragraph('Reading the Room', styles['heading']))
        elements.append(_build_two_columns(
            rr.get('working', []), rr.get('stalling', []), styles
        ))

    # Reset Moves
    if mg.get('resetMoves'):
        elements.append(Spacer(1, 12))
        elements.append(AccentLineFlowable2(CORAL))
        elements.append(Paragraph('Reset Moves', styles['heading']))
        for item in mg['resetMoves']:
            elements.append(Paragraph(f'\u2022  {_md_inline_to_html(item)}', styles['bullet']))

    return elements


def build_sources(data, styles, accent_color=CORAL):
    """Build sources list pages."""
    elements = []
    sources = data.get('sources', [])

    class AccentLineFlowable3(Flowable):
        def __init__(self, color):
            super().__init__()
            self.color = color
        def wrap(self, aW, aH):
            return (40, 10)
        def draw(self):
            self.canv.setFillColor(self.color)
            self.canv.rect(0, 4, 40, 2, stroke=0, fill=1)

    elements.append(AccentLineFlowable3(accent_color))
    elements.append(Paragraph(
        f'{len(sources)} Research Sources', styles['heading']
    ))
    elements.append(Spacer(1, 8))

    max_display = 50
    for i, source in enumerate(sources[:max_display]):
        title = source.get('title', source.get('url', ''))
        url = source.get('url', '')
        try:
            from urllib.parse import urlparse
            domain = urlparse(url).hostname or url
            domain = domain.replace('www.', '')
        except Exception:
            domain = url

        elements.append(Paragraph(
            f'<b>{i + 1}.</b>  {_escape_xml(title)}',
            styles['source_title']
        ))
        elements.append(Paragraph(domain, styles['source_domain']))
        elements.append(Spacer(1, 6))

    if len(sources) > max_display:
        elements.append(Spacer(1, 8))
        elements.append(Paragraph(
            f'+ {len(sources) - max_display} additional sources',
            styles['source_domain']
        ))

    return elements


# ─── Inline flowable builders ─────────────────────────────────────────────────

def _build_insight_box(text, accent_color, styles):
    """Build an insight callout box as a Table flowable."""
    class InsightBoxFlowable(Flowable):
        def __init__(self, text, accent, width):
            super().__init__()
            self.text = text
            self.accent = accent
            self.box_width = width
            self._para = None
            self._h = 0

        def wrap(self, aW, aH):
            sans_italic = 'DMSans-Italic' if 'DMSans-Italic' in self.canv.getAvailableFonts() else 'Helvetica-Oblique' if hasattr(self, 'canv') else 'Helvetica-Oblique'
            style = ParagraphStyle(
                'ib', fontName='DMSans-Italic',
                fontSize=9.5, leading=14, textColor=BODY_TEXT,
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
    """Build a meeting move card as a Flowable."""
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
            sans = 'DMSans'
            sans_bold = 'DMSans-Bold'
            sans_italic = 'DMSans-Italic'

            ts = ParagraphStyle('mt', fontName=sans_bold, fontSize=11, leading=15, textColor=CHARCOAL)
            self._title_p = Paragraph(
                f"{self.move_data.get('number', '')}. {_md_inline_to_html(self.move_data.get('title', ''))}",
                ts
            )
            _, th = self._title_p.wrap(inner, aH)

            ms = ParagraphStyle('mm', fontName=sans, fontSize=9, leading=13, textColor=BODY_TEXT)
            self._move_p = Paragraph(_md_inline_to_html(self.move_data.get('moveText', '')), ms)
            _, mh = self._move_p.wrap(inner, aH)

            rs = ParagraphStyle('mr', fontName=sans_italic, fontSize=9, leading=13, textColor=BODY_TEXT)
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

            c.setFont('DMSans-Bold' if 'DMSans-Bold' in c.getAvailableFonts() else 'Helvetica-Bold', 7.5)
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
    # Escape XML first, then convert markdown
    text = _escape_xml(text)
    # ***bold italic***
    text = re.sub(r'\*\*\*(.+?)\*\*\*', r'<b><i>\1</i></b>', text)
    # **bold**
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    # *italic*
    text = re.sub(r'\*(.+?)\*', r'<i>\1</i>', text)
    return text


# ─── Main PDF builder ─────────────────────────────────────────────────────────

def generate_pdf(data, output_path):
    """Generate a PDF from structured profile data."""
    fonts = register_fonts()
    styles = make_styles(fonts)

    # Create document with custom page templates
    doc = BaseDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN + 10,
        bottomMargin=MARGIN,
        title=f"{data['donorName']} — ProspectAI Donor Intelligence",
        author='ProspectAI / Democracy Takes Work',
    )

    # Frames
    dark_frame = Frame(MARGIN, MARGIN, CONTENT_WIDTH, PAGE_HEIGHT - 2 * MARGIN,
                       id='dark_frame', showBoundary=0)
    content_frame = Frame(MARGIN, MARGIN + 10, CONTENT_WIDTH, PAGE_HEIGHT - 2 * MARGIN - 20,
                          id='content_frame', showBoundary=0)

    # Page templates
    dark_template = PageTemplate(id='dark', frames=[dark_frame], onPage=draw_dark_page)
    content_template = PageTemplate(id='content', frames=[content_frame], onPage=draw_content_page)

    doc.addPageTemplates([dark_template, content_template])

    # Build story
    story = []

    # ─── Cover page (dark) ───
    story.extend(build_cover_page(data, styles))

    # ─── Section 1: Persuasion Profile ───
    # Content starts directly (no section cover page — saves a blank page)
    story.append(NextPageTemplate('content'))
    story.append(PageBreak())

    # Profile content
    story.extend(build_persuasion_profile(data, styles, PURPLE))

    # ─── Section 2: Meeting Guide ───
    if data.get('meetingGuide') and (
        data['meetingGuide'].get('format') == 'v3' or
        data['meetingGuide'].get('donorRead') or
        data['meetingGuide'].get('meetingArc') or
        data['meetingGuide'].get('lightsUp')
    ):
        story.append(NextPageTemplate('dark'))
        story.append(PageBreak())
        story.extend(build_section_cover(
            '2', 'Meeting Guide',
            'Tactical preparation for your conversation — what to say, when to say it, and how to read the room.',
            GREEN, styles
        ))
        story.append(NextPageTemplate('content'))
        story.append(PageBreak())
        story.extend(build_meeting_guide(data, styles, GREEN))

    # ─── Section 3: Sources ───
    # Content starts directly (no section cover page — saves a blank page)
    story.append(NextPageTemplate('content'))
    story.append(PageBreak())
    story.extend(build_sources(data, styles, CORAL))

    # Build
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
