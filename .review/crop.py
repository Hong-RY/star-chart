import os
from PIL import Image
base = r"D:\dsh工作区\star-chart"
out = os.path.join(base, ".review")
os.makedirs(out, exist_ok=True)
jobs = [
 ("title","t_btn",(80,680,640,860),2.0),
 ("title","t_chapter",(20,20,440,210),2.0),
 ("title","t_center",(560,240,1400,960),1.4),
 ("title","t_br",(1380,760,1900,1000),2.0),
 ("play","p_life",(30,870,260,990),4.0),
 ("play","p_br",(1400,880,1740,980),4.0),
 ("play","p_ship",(800,680,1000,840),4.0),
 ("play","p_meteor",(350,290,520,460),4.0),
 ("play","p_hud",(1400,40,1920,320),2.0),
 ("play","p_banner",(640,120,1280,300),2.0),
 ("clear","c_text",(660,300,1200,480),2.0),
 ("over","o_btn",(700,640,1220,800),2.5),
 ("over","o_panel",(480,240,1460,800),1.4),
 ("slow","s_label",(1400,520,1800,700),2.0),
]
for src,name,box,s in jobs:
    folder = "docs" if src in ("title","play","clear","over") else "shots"
    im = Image.open(os.path.join(base,folder,src+".png")).convert("RGB")
    c = im.crop(box)
    c = c.resize((int(c.width*s), int(c.height*s)), Image.LANCZOS)
    p = os.path.join(out, src+"_"+name+".png")
    c.save(p)
    print(p, c.size)
