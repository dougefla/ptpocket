#!/usr/bin/env python3
"""生成 PWA 图标。改了设计就重跑：python3 web/scripts/gen-icons.py"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public"
BG_TOP = (76, 141, 255)
BG_BOTTOM = (123, 63, 242)
FG = (255, 255, 255)

# 放大后再缩小，等价于抗锯齿
SS = 4


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(size - 1, 1)
        img.putpixel(
            (0, y),
            tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM)),
        )
    return img.resize((size, size), Image.NEAREST)


def arrow(draw: ImageDraw.ImageDraw, size: int) -> None:
    """向下的下载箭头 + 底部托盘线"""
    cx = size / 2
    stem_w = size * 0.108
    stem_top = size * 0.235
    stem_bottom = size * 0.545
    head_w = size * 0.30
    head_tip = size * 0.70

    draw.rounded_rectangle(
        [cx - stem_w / 2, stem_top, cx + stem_w / 2, stem_bottom],
        radius=stem_w / 2,
        fill=FG,
    )
    draw.polygon(
        [(cx - head_w, stem_bottom - size * 0.045), (cx + head_w, stem_bottom - size * 0.045), (cx, head_tip)],
        fill=FG,
    )
    tray_w = size * 0.42
    tray_h = size * 0.072
    tray_y = size * 0.775
    draw.rounded_rectangle(
        [cx - tray_w, tray_y, cx + tray_w, tray_y + tray_h],
        radius=tray_h / 2,
        fill=FG,
    )


def build(size: int, *, maskable: bool = False, rounded: bool = False) -> Image.Image:
    s = size * SS
    img = gradient(s).convert("RGBA")

    if rounded:
        # iOS 会自己套圆角遮罩，这里给 apple-touch-icon 留直角；
        # rounded 只用于 favicon 场景
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.225, fill=255)
        img.putalpha(mask)

    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    if maskable:
        # maskable 图标要留 20% 安全边距，画在中间 60% 区域里
        inner = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        di = ImageDraw.Draw(inner)
        arrow(di, s)
        inner = inner.resize((int(s * 0.62), int(s * 0.62)), Image.LANCZOS)
        layer.paste(inner, (int(s * 0.19), int(s * 0.19)), inner)
    else:
        arrow(d, s)

    img = Image.alpha_composite(img, layer)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    targets = [
        ("icon-192.png", build(192, rounded=True)),
        ("icon-512.png", build(512, rounded=True)),
        ("icon-maskable-512.png", build(512, maskable=True)),
        # iOS 主屏图标必须是不透明直角方图，系统自己切圆角
        ("apple-touch-icon.png", build(180).convert("RGB")),
    ]
    for name, img in targets:
        path = OUT / name
        img.save(path, "PNG", optimize=True)
        print(f"  {name:26} {path.stat().st_size:>7,} B")


if __name__ == "__main__":
    main()
