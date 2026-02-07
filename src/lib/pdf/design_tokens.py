"""DTW Design System tokens for PDF generation."""

from reportlab.lib.colors import HexColor

# ─── Colors ──────────────────────────────────────────────────────────────────

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
GOLD         = HexColor('#F9C74F')

# Section accent mapping
SECTION_COLORS = {
    'persuasion_profile': PURPLE,
    'meeting_guide': GREEN,
    'sources': CORAL,
}

# ─── Typography sizes (points) ───────────────────────────────────────────────

COVER_NAME_SIZE     = 52
COVER_SUBTITLE_SIZE = 14
COVER_OVERLINE_SIZE = 8.5
COVER_META_SIZE     = 9

SECTION_TITLE_SIZE  = 44
SECTION_OVERLINE_SIZE = 9
SECTION_DESC_SIZE   = 11

HEADING_SIZE        = 18
SUBHEADING_SIZE     = 13
BODY_SIZE           = 9.5
BODY_LEADING        = 14
SMALL_SIZE          = 8
FOOTER_SIZE         = 7.5

CARD_TITLE_SIZE     = 11
CARD_BODY_SIZE      = 9
CARD_LABEL_SIZE     = 7.5

# ─── Page dimensions ─────────────────────────────────────────────────────────

from reportlab.lib.pagesizes import letter
PAGE_WIDTH, PAGE_HEIGHT = letter

MARGIN_LEFT   = 54   # 0.75in
MARGIN_RIGHT  = 54
MARGIN_TOP    = 54
MARGIN_BOTTOM = 54

CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT

# ─── Gradient stops ──────────────────────────────────────────────────────────

GRADIENT_STOPS = [
    (0.0, PURPLE),
    (0.33, GREEN),
    (0.66, CORAL),
    (1.0, PURPLE),
]

GRADIENT_BAR_HEIGHT = 6
THIN_GRADIENT_HEIGHT = 3
ACCENT_LINE_WIDTH = 40
ACCENT_LINE_HEIGHT = 2
