from PIL import Image, ImageDraw, ImageFont
S = 512
im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle((0, 0, S - 1, S - 1), 96, fill=(24, 28, 43, 255))
d.rounded_rectangle((18, 18, S - 19, S - 19), 80, outline=(212, 168, 67, 255), width=8)
font = None
for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"):
    try:
        font = ImageFont.truetype(p, 250); break
    except Exception:
        pass
font = font or ImageFont.load_default()
txt = "{T}"
w = d.textlength(txt, font=font)
d.text(((S - w) / 2, 120), txt, font=font, fill=(240, 236, 224, 255))
d.rectangle((120, 400, 392, 412), fill=(212, 168, 67, 255))
im.resize((128, 128), Image.LANCZOS).save("images/icon.png")
