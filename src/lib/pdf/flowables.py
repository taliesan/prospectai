"""Custom ReportLab flowables for DTW PDF design system."""

from reportlab.platypus import Flowable, Paragraph, Table, TableStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, Color
from reportlab.lib.enums import TA_LEFT, TA_JUSTIFY, TA_CENTER
from reportlab.lib.styles import ParagraphStyle

from .design_tokens import (
    CHARCOAL, WARM_WHITE, PARCHMENT, STONE, BODY_TEXT, LIGHT_GRAY, WHITE,
    PURPLE, PURPLE_LIGHT, GREEN, GREEN_LIGHT, CORAL,
    GRADIENT_STOPS, GRADIENT_BAR_HEIGHT, THIN_GRADIENT_HEIGHT,
    ACCENT_LINE_WIDTH, ACCENT_LINE_HEIGHT,
    CONTENT_WIDTH, MARGIN_LEFT,
    HEADING_SIZE, BODY_SIZE, BODY_LEADING, CARD_TITLE_SIZE, CARD_BODY_SIZE, CARD_LABEL_SIZE,
)


class GradientBar(Flowable):
    """Horizontal gradient bar across the page width."""

    def __init__(self, width, height=GRADIENT_BAR_HEIGHT, full_page_width=False):
        super().__init__()
        self.bar_width = width
        self.bar_height = height
        self.full_page_width = full_page_width

    def wrap(self, availWidth, availHeight):
        return (self.bar_width, self.bar_height)

    def draw(self):
        canvas = self.canv
        steps = 100
        step_width = self.bar_width / steps

        for i in range(steps):
            t = i / steps
            # Interpolate through gradient stops
            color = _interpolate_gradient(t, GRADIENT_STOPS)
            canvas.setFillColor(color)
            canvas.rect(i * step_width, 0, step_width + 0.5, self.bar_height, stroke=0, fill=1)


class AccentLine(Flowable):
    """A thin colored line that introduces subsections."""

    def __init__(self, color, width=ACCENT_LINE_WIDTH, height=ACCENT_LINE_HEIGHT):
        super().__init__()
        self.color = color
        self.line_width = width
        self.line_height = height

    def wrap(self, availWidth, availHeight):
        return (self.line_width, self.line_height + 8)  # 8pt spacing below

    def draw(self):
        self.canv.setFillColor(self.color)
        self.canv.rect(0, 8, self.line_width, self.line_height, stroke=0, fill=1)


class InsightBox(Flowable):
    """Callout box with left accent bar, tinted background, italic text."""

    def __init__(self, text, accent_color, width=None, font_name='DMSans', font_size=BODY_SIZE):
        super().__init__()
        self.text = text
        self.accent_color = accent_color
        self.box_width = width or CONTENT_WIDTH
        self.font_name = font_name
        self.font_size = font_size
        self._para = None
        self._height = 0

    def wrap(self, availWidth, availHeight):
        style = ParagraphStyle(
            'insight',
            fontName=self.font_name + '-Italic' if self.font_name == 'DMSans' else self.font_name,
            fontSize=self.font_size,
            leading=self.font_size * 1.5,
            textColor=BODY_TEXT,
            alignment=TA_LEFT,
        )
        inner_width = self.box_width - 20 - 3.5  # padding + accent bar
        self._para = Paragraph(self.text, style)
        w, h = self._para.wrap(inner_width, availHeight)
        self._height = h + 20  # padding top + bottom
        return (self.box_width, self._height)

    def draw(self):
        canvas = self.canv
        h = self._height

        # Background with rounded right corners
        canvas.setFillColor(PARCHMENT)
        canvas.roundRect(0, 0, self.box_width, h, 4, stroke=0, fill=1)

        # Left accent bar
        canvas.setFillColor(self.accent_color)
        canvas.rect(0, 0, 3.5, h, stroke=0, fill=1)

        # Text
        if self._para:
            self._para.drawOn(canvas, 16, 10)


class MeetingMoveCard(Flowable):
    """White card for meeting arc moves with accent bar and read section."""

    def __init__(self, number, title, move_text, read_text, accent_color=GREEN, width=None,
                 font_name='DMSans', serif_name='InstrumentSerif'):
        super().__init__()
        self.number = number
        self.title = title
        self.move_text = move_text
        self.read_text = read_text
        self.accent_color = accent_color
        self.card_width = width or CONTENT_WIDTH
        self.font_name = font_name
        self.serif_name = serif_name
        self._height = 0
        self._move_para = None
        self._read_para = None
        self._title_para = None

    def wrap(self, availWidth, availHeight):
        inner = self.card_width - 32  # 16px padding each side

        title_style = ParagraphStyle(
            'move_title',
            fontName=self.font_name + '-Bold',
            fontSize=CARD_TITLE_SIZE,
            leading=CARD_TITLE_SIZE * 1.3,
            textColor=CHARCOAL,
        )
        self._title_para = Paragraph(
            f'<b>{self.number}. {self.title}</b>', title_style
        )
        _, th = self._title_para.wrap(inner, availHeight)

        move_style = ParagraphStyle(
            'move_body',
            fontName=self.font_name,
            fontSize=CARD_BODY_SIZE,
            leading=CARD_BODY_SIZE * 1.5,
            textColor=BODY_TEXT,
        )
        self._move_para = Paragraph(self.move_text, move_style)
        _, mh = self._move_para.wrap(inner, availHeight)

        read_style = ParagraphStyle(
            'move_read',
            fontName=self.font_name + '-Italic',
            fontSize=CARD_BODY_SIZE,
            leading=CARD_BODY_SIZE * 1.5,
            textColor=BODY_TEXT,
        )
        self._read_para = Paragraph(self.read_text, read_style)
        _, rh = self._read_para.wrap(inner, availHeight)

        # 3px accent + 12 pad top + title + 8 + move + 10 + divider + 10 + label + 4 + read + 12 pad bottom
        self._height = 3 + 12 + th + 8 + mh + 10 + 1 + 10 + 10 + 4 + rh + 12
        return (self.card_width, self._height)

    def draw(self):
        canvas = self.canv
        w = self.card_width
        h = self._height

        # White card background with stone border
        canvas.setStrokeColor(STONE)
        canvas.setLineWidth(0.5)
        canvas.setFillColor(WHITE)
        canvas.roundRect(0, 0, w, h, 4, stroke=1, fill=1)

        # Green accent bar at top
        canvas.setFillColor(self.accent_color)
        canvas.rect(0, h - 3, w, 3, stroke=0, fill=1)

        inner_left = 16
        y = h - 3 - 12  # below accent bar + padding

        # Title
        if self._title_para:
            tw, th_t = self._title_para.wrap(w - 32, 1000)
            self._title_para.drawOn(canvas, inner_left, y - th_t)
            y -= th_t + 8

        # Move text
        if self._move_para:
            mw, mh = self._move_para.wrap(w - 32, 1000)
            self._move_para.drawOn(canvas, inner_left, y - mh)
            y -= mh + 10

        # Divider
        canvas.setStrokeColor(STONE)
        canvas.setLineWidth(0.5)
        canvas.line(inner_left, y, w - 16, y)
        y -= 10

        # "THE READ" label
        canvas.setFont(self.font_name + '-Bold', CARD_LABEL_SIZE)
        canvas.setFillColor(LIGHT_GRAY)
        canvas.drawString(inner_left, y, 'THE READ')
        y -= 14

        # Read text
        if self._read_para:
            rw, rh = self._read_para.wrap(w - 32, 1000)
            self._read_para.drawOn(canvas, inner_left, y - rh)


class TwoColumnSignals(Flowable):
    """Side-by-side Working/Stalling signal columns."""

    def __init__(self, working_items, stalling_items, width=None, font_name='DMSans'):
        super().__init__()
        self.working = working_items
        self.stalling = stalling_items
        self.box_width = width or CONTENT_WIDTH
        self.font_name = font_name
        self._height = 0

    def wrap(self, availWidth, availHeight):
        col_width = (self.box_width - 12) / 2  # 12px gap
        item_height = 16  # approximate per item
        max_items = max(len(self.working), len(self.stalling))
        self._height = 30 + max_items * item_height + 16  # header + items + padding
        return (self.box_width, self._height)

    def draw(self):
        canvas = self.canv
        w = self.box_width
        h = self._height
        col_w = (w - 12) / 2

        # Left column — green tint
        green_bg = HexColor('#E8F5E9')
        canvas.setFillColor(green_bg)
        canvas.roundRect(0, 0, col_w, h, 4, stroke=0, fill=1)

        # Right column — coral tint
        coral_bg = HexColor('#FBE9E7')
        canvas.setFillColor(coral_bg)
        canvas.roundRect(col_w + 12, 0, col_w, h, 4, stroke=0, fill=1)

        # Headers
        canvas.setFont(self.font_name + '-Bold', 8)
        canvas.setFillColor(GREEN)
        canvas.drawString(10, h - 18, 'WORKING')
        canvas.setFillColor(CORAL)
        canvas.drawString(col_w + 22, h - 18, 'STALLING')

        # Items
        canvas.setFont(self.font_name, 8.5)
        y = h - 36

        canvas.setFillColor(HexColor('#2D6A4F'))
        for item in self.working:
            text = f'\u2713  {item}'
            canvas.drawString(10, y, text[:60])
            y -= 16

        y = h - 36
        canvas.setFillColor(HexColor('#E07A5F'))
        for item in self.stalling:
            text = f'\u2717  {item}'
            canvas.drawString(col_w + 22, y, text[:60])
            y -= 16


class VerticalSpacer(Flowable):
    """Simple vertical spacer."""

    def __init__(self, height):
        super().__init__()
        self._height = height

    def wrap(self, availWidth, availHeight):
        return (0, self._height)

    def draw(self):
        pass


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _interpolate_gradient(t, stops):
    """Interpolate color at position t (0-1) through gradient stops."""
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
