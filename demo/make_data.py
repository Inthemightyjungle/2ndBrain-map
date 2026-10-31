"""Build a fictional sample dataset for the public demo of the Inspirations map. Nothing here comes from team data."""
import json, random, datetime, re, os
HERE = os.path.dirname(os.path.abspath(__file__))
R = random.Random(7)
DAY = 86400000
def ms(d): return int(datetime.datetime(d.year, d.month, d.day).timestamp() * 1000)
def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40]
meta = json.load(open(os.path.join(HERE, "categories.json")))
meta = {"categories": meta["categories"], "labels": {"core": {"name": "Demo Studio"}, "grp:Calendar": {"name": "Team Calendar"}, "grp:Horizon": {"name": "Horizon Scans"}}}
NOW = datetime.date(2026, 10, 30)
HANDLES = ["pixel.forge", "render.daily", "nodeworks", "lumen.lab", "frame.theory", "motion.notes", "studio.kite", "vfx.digest", "polycount.club", "future.screens", "dev.signal", "neon.atlas"]
FORMATS = ["Tutorial", "Breakdown", "Showcase", "News", "Tool launch", "Tips"]
SOURCES = ["Creator", "Studio", "Media", "Tool maker"]
VERBS = ["How to", "Fast", "Inside", "A look at", "Rebuilding", "Testing", "Five tips for", "Behind", "Making", "Lighting"]
NOUNS = {
 "ai-video": ["text-to-video shots", "AI camera moves", "consistent AI characters", "storyboards to motion", "AI lip sync"],
 "ai-image": ["AI product photos", "style reference boards", "AI upscaling", "prompted concept art", "AI relighting stills"],
 "ai-3d": ["image-to-3D meshes", "splat scenes", "AI textures", "room scans to 3D", "AI rigging"],
 "ai-vfx": ["AI rotoscoping", "AI cleanup plates", "AI sky swaps", "AI de-aging", "AI keying"],
 "ai-tools": ["AI script helpers", "agent workflows", "AI shot lists", "voice tools", "AI review notes"],
 "vfx-breakdowns": ["a city destruction shot", "a creature reveal", "a car chase comp", "an ocean storm", "a crowd sim"],
 "mocap": ["suitless mocap", "facial capture", "digital doubles", "hand tracking rigs", "phone mocap"],
 "realtime": ["LED volume shoots", "real-time previs", "virtual scouting", "in-camera VFX", "game-engine cinematics"],
 "fx-sim": ["fluid sims", "destruction sims", "cloth sims", "particle magic", "smoke and fire"],
 "3d": ["hard-surface models", "procedural cities", "stylised props", "asset libraries", "geometry nodes"],
 "comp": ["edit rhythm", "colour matching plates", "multi-pass comps", "title sequences", "fast roto"],
 "camera": ["anamorphic looks", "practical lighting", "night exteriors", "colour grading", "lens choices"],
 "motion": ["kinetic type", "2D character loops", "logo reveals", "UI animation", "isometric scenes"],
 "tech-ai": ["new AI chips", "open model releases", "AI in classrooms", "AI and jobs", "on-device AI"],
 "tech-xr": ["holographic displays", "mixed-reality headsets", "transparent screens", "light-field displays", "spatial video"],
 "tech-interactive": ["projection mapping", "interactive floors", "touch walls", "sensor installations", "kinetic sculptures"],
 "tech-robotics": ["camera robots", "drone shows", "desk robots", "robot arms on set", "smart gadgets"],
 "tech-capture": ["photogrammetry rigs", "LiDAR on phones", "volumetric capture", "gaussian splats", "360 capture"],
 "ideas": ["a festival installation", "an AR treasure hunt", "a short film format", "a museum walkthrough", "a live visuals set"],
 "learning": ["Houdini basics", "Nuke shortcuts", "Blender drivers", "Unreal sequencer", "shader graphs"],
 "books": ["visual storytelling", "colour theory", "animation timing", "game feel", "creative habits"],
}
TOPICS = {  # group category -> topic titles (2-3 per category)
 "ai-video": ["Text-to-video models", "AI characters that stay consistent", "AI music videos"],
 "ai-image": ["AI product imagery", "Concept art with AI"],
 "ai-3d": ["Image to 3D", "Splats and AI scenes"],
 "ai-vfx": ["AI cleanup and roto", "AI relighting"],
 "ai-tools": ["Agents for production", "AI writing helpers"],
 "vfx-breakdowns": ["Feature film breakdowns", "Commercial breakdowns", "Game cinematics"],
 "mocap": ["Markerless capture", "Digital humans"],
 "realtime": ["LED volumes", "Real-time previs"],
 "fx-sim": ["Water and fluids", "Destruction"],
 "3d": ["Procedural modelling", "Stylised assets"],
 "comp": ["Compositing tricks", "Editing for social"],
 "camera": ["Lighting setups", "Grading looks"],
 "motion": ["Type in motion", "Character loops"],
 "tech-ai": ["AI hardware", "AI and society"],
 "tech-xr": ["New displays", "Headsets"],
 "tech-interactive": ["Projection mapping", "Interactive spaces"],
 "tech-robotics": ["Robots on set", "Gadgets"],
 "tech-capture": ["Scanning the world", "Volumetric video"],
 "ideas": ["Installation ideas", "Format ideas"],
 "learning": ["Courses to take", "Tool shortcuts"],
 "books": ["Reading list"],
}
notes = {}
def add(id, **kw):
    kw.setdefault("links", []); kw.setdefault("created", ms(NOW) - R.randint(30, 400) * DAY); kw.setdefault("updated", kw["created"])
    notes[id] = kw; return id
def post(cat):
    d = NOW - datetime.timedelta(days=int(R.betavariate(1.2, 4) * 2200))
    noun = R.choice(NOUNS[cat]); h = R.choice(HANDLES)
    desc = f"{R.choice(VERBS)} {noun}"
    code = "".join(R.choice("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789") for _ in range(10))
    tags = f"{R.choice(FORMATS)} · {R.choice(SOURCES)} · {R.choice(['Blender', 'Unreal', 'Houdini', 'Nuke', 'After Effects', '—'])} · {noun}"
    return d, f"- [{d.isoformat()}] @{h}: {desc}\n  https://example.com/demo/{code}\n  Tags: {tags}"
ids_by_cat = {}
for cat, titles in TOPICS.items():
    for t in titles:
        n = R.randint(3, 11)
        ps = sorted((post(cat) for _ in range(n)), key=lambda x: x[0], reverse=True)
        body = f"Sample topic for the demo: {t.lower()}.\n\n## Saved posts ({n})\n" + "\n".join(p[1] for p in ps)
        i = add("demo-" + slug(t), title=t, body=body, cat=cat, source="Sample data", date=ms(ps[-1][0]))
        ids_by_cat.setdefault(cat, []).append(i)
# a few sub-topics, and some cross links between related topics
for cat, ids in list(ids_by_cat.items()):
    if R.random() < 0.45:
        parent = notes[ids[0]]["title"]; t = parent + ": deep dive"
        ps = [post(cat) for _ in range(R.randint(2, 5))]
        add("demo-" + slug(t), title=t, body=f"Part of [[{parent}]].\n\n## Saved posts ({len(ps)})\n" + "\n".join(p[1] for p in ps), cat=cat, source="Sample data")
allt = [i for v in ids_by_cat.values() for i in v]
for i in allt:
    notes[i]["links"] = R.sample([x for x in allt if x != i], R.randint(0, 2))
# horizon scans
for cat, ts in {"hz-content": ["Scan: AI video tools", "Scan: interactive formats"], "hz-channel": ["Scan: short-form platforms"], "audience": ["Scan: Gen Z viewing habits"], "hz-org": ["Scan: small-team pipelines"]}.items():
    for t in ts:
        add("demo-" + slug(t), title=t, body="Sample horizon scan for the demo.\n\n## Scans\n" + "\n".join(post(R.choice(list(NOUNS)))[1] for _ in range(R.randint(2, 4))), cat=cat, source="Sample data", hub=True, links=R.sample(allt, 2))
# projects and people (all fictional)
PEOPLE = ["Ava", "Ben", "Chloe", "Dev", "Ethan", "Farah", "Gabe", "Hana"]
for p in PEOPLE: add("demo-person-" + p.lower(), title=p, body=f"{p} is a sample team member in the demo.", cat="proj-team", source="Sample data")
PROJ = [("Neon Night Market", "proj-active"), ("Museum AR Trail", "proj-active"), ("Drone Light Show", "proj-active"), ("Holo Lobby Display", "proj-next"), ("Virtual Set Test", "proj-next"),
        ("Robot Barista Film", "proj-hold"), ("Festival Projection", "cmvs6ihmd"), ("Splat Tour Prototype", "cmvs6ihmd"), ("AI Trailer Pilot", "cmvs6ihmd"), ("Weekly Show & Tell", "proj-process")]
for t, cat in PROJ:
    lead, *team = R.sample(PEOPLE, 3)
    st = {"proj-active": "In progress", "proj-next": "Not started", "proj-hold": "On hold", "cmvs6ihmd": "Done", "proj-process": "Ongoing"}[cat]
    due = (NOW + datetime.timedelta(days=R.randint(-200, 120))).isoformat()
    kw = dict(title=t, body=f"Sample project · Status: {st}.\nLead: {lead}\nTeam: {', '.join(team)}\nDeadline: {due}", cat=cat, source="Sample data", status=st, due=due,
              links=R.sample(allt, 2), date=ms(NOW) - R.randint(60, 500) * DAY)
    if cat == "proj-active": kw["milestone"] = due
    add("demo-proj-" + slug(t), **kw)
# calendar
for t, dd in [("Studio open day", 14), ("Year-end showcase", 45), ("Hack week", -20)]:
    d = NOW + datetime.timedelta(days=dd)
    add("demo-cal-" + slug(t), title=t, body=f"Sample company event on {d.isoformat()}.", cat="cal-events", source="Sample data", event=d.isoformat(), date=ms(d))
# built with Claude
for t, cat in [("Pixel Dash", "claude-games"), ("Tower Builder", "claude-games"), ("Pitch: Sky Garden", "claude-docs"), ("Short story: The Last Signal", "claude-stories"),
               ("Budget tracker", "claude-tools"), ("Market scan report", "claude-research"), ("App mockups", "claude-design")]:
    add("demo-claude-" + slug(t), title=t, body="Sample item made with Claude for the demo.", cat=cat, source="Sample data", hub=True)
DATA = {"notes": notes, "meta": meta, "author": {"name": "Demo"}}
json.dump(DATA, open(os.path.join(HERE, "demo-data.json"), "w"), ensure_ascii=False)
print(len(notes), "notes", sum(n["body"].count("https://example.com") for n in notes.values()), "posts")
