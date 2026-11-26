import os
import subprocess
import tempfile
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG_PATH = os.path.join(ROOT, 'public', 'emblem.svg')
PUBLIC_DIR = os.path.join(ROOT, 'public')
EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

with open(SVG_PATH, 'r', encoding='utf-8') as f:
    svg_content = f.read()

# Create a clean HTML wrapper for rendering 512x512 with transparent background
html_content = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {{
    margin: 0;
    padding: 0;
    width: 512px;
    height: 512px;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }}
  svg {{
    width: 512px;
    height: 512px;
  }}
</style>
</head>
<body>
{svg_content}
</body>
</html>
"""

temp_dir = tempfile.mkdtemp()
temp_html = os.path.join(temp_dir, 'icon.html')
temp_png = os.path.join(temp_dir, 'icon-512.png')

with open(temp_html, 'w', encoding='utf-8') as f:
    f.write(html_content)

print(f"Rendering 512x512 PNG via Headless Edge...")
cmd = [
    EDGE_PATH,
    "--headless=new",
    "--disable-gpu",
    "--force-device-scale-factor=1",
    "--window-size=512,512",
    "--default-background-color=00000000",
    f"--screenshot={temp_png}",
    f"file:///{temp_html.replace(os.sep, '/')}"
]

subprocess.run(cmd, check=True)

if not os.path.exists(temp_png):
    raise RuntimeError(f"Screenshot failed: {temp_png} not found")

img = Image.open(temp_png).convert("RGBA")
print(f"Rendered image size: {img.size}, mode: {img.mode}")

# 1. Multi-resolution favicon.ico
ico_path = os.path.join(PUBLIC_DIR, 'favicon.ico')
img.save(
    ico_path,
    format='ICO',
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64)]
)
print(f"Generated: {ico_path} (sizes: 16, 32, 48, 64)")

# 2. Standalone PNG icons for Google, Bing, iOS, and PWA
png_targets = {
    'favicon-16x16.png': (16, 16),
    'favicon-32x32.png': (32, 32),
    'favicon-48x48.png': (48, 48),
    'apple-touch-icon.png': (180, 180),
    'apple-touch-icon-precomposed.png': (180, 180),
    'icon-192.png': (192, 192),
    'icon-512.png': (512, 512),
    'emblem.png': (512, 512)
}

for name, size in png_targets.items():
    out_path = os.path.join(PUBLIC_DIR, name)
    resized = img.resize(size, Image.Resampling.LANCZOS)
    resized.save(out_path, format='PNG')
    print(f"Generated: {out_path} ({size[0]}x{size[1]})")

# Clean up
try:
    os.remove(temp_html)
    os.remove(temp_png)
    os.rmdir(temp_dir)
except Exception:
    pass

print("All favicons successfully generated!")
