"""Genera ícono de app, adaptive icon y notification icon desde el logo fuente."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets" / "brand"
SOURCE = BRAND / "logo-source-hires.png"
BRAND_RED = (154, 15, 18, 255)  # #9A0F12
SIZE = 1024
# Zona segura Android ~66%; el isotipo queda en ~58% para que no lo recorte el círculo.
LOGO_FILL = 0.58
NOTIFICATION_SIZE = 96
NOTIFICATION_FILL = 0.78


def extract_logo_rgba(src: Image.Image) -> Image.Image:
    arr = np.array(src.convert("RGBA"))
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3].astype(np.float32)

    # Rojo de marca muestreado lejos de esquinas y del isotipo.
    patch = rgb[h // 2 - 18 : h // 2 + 18, int(w * 0.08) : int(w * 0.16)]
    bg = patch.mean(axis=(0, 1))

    # Canal G/B: el fondo rojo es oscuro, el logo blanco es claro.
    luma_gb = (rgb[:, :, 1] + rgb[:, :, 2]) * 0.5
    alpha = np.clip((luma_gb - 55.0) / (210.0 - 55.0), 0.0, 1.0)

    yy, xx = np.ogrid[:h, :w]
    radius = np.sqrt((xx - (w / 2.0)) ** 2 + (yy - (h / 2.0)) ** 2)
    alpha = np.where(radius < min(w, h) * 0.40, alpha, 0.0)

    ys, xs = np.where(alpha > 0.12)
    if len(xs) == 0:
        raise RuntimeError("No se pudo extraer el isotipo del archivo fuente.")

    pad = 8
    x0 = max(int(xs.min()) - pad, 0)
    x1 = min(int(xs.max()) + pad + 1, w)
    y0 = max(int(ys.min()) - pad, 0)
    y1 = min(int(ys.max()) + pad + 1, h)

    crop_a = alpha[y0:y1, x0:x1]
    out = np.zeros((y1 - y0, x1 - x0, 4), dtype=np.uint8)
    out[:, :, 0:3] = 255
    out[:, :, 3] = np.clip(np.round(crop_a * 255.0), 0, 255).astype(np.uint8)
    out[:, :, 3] = np.where(out[:, :, 3] < 8, 0, out[:, :, 3])
    return Image.fromarray(out, "RGBA")


def fit_logo(logo: Image.Image, canvas: int, fill: float) -> Image.Image:
    lw, lh = logo.size
    target = max(1, int(round(canvas * fill)))
    scale = target / max(lw, lh)
    nw = max(1, int(round(lw * scale)))
    nh = max(1, int(round(lh * scale)))
    resized = logo.resize((nw, nh), Image.Resampling.LANCZOS)
    layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    layer.paste(resized, ((canvas - nw) // 2, (canvas - nh) // 2), resized)
    return layer


def main() -> None:
    src = Image.open(SOURCE)
    logo = extract_logo_rgba(src)
    logo.save(BRAND / "logo-mark.png", "PNG")

    mark = fit_logo(logo, SIZE, LOGO_FILL)
    mark.save(BRAND / "adaptive-icon-foreground.png", "PNG")

    icon = Image.new("RGBA", (SIZE, SIZE), BRAND_RED)
    icon.alpha_composite(mark)
    icon.save(BRAND / "icon-1024.png", "PNG")
    # Compatibilidad con rutas previas.
    icon.save(BRAND / "logo-app-icon-no-plate.png", "PNG")

    notif = fit_logo(logo, NOTIFICATION_SIZE, NOTIFICATION_FILL)
    notif.save(BRAND / "notification-icon.png", "PNG")

    print("logo", logo.size)
    print("icon", icon.size)
    print("adaptive", mark.size)
    print("notification", notif.size)


if __name__ == "__main__":
    main()
