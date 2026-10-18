# Shallow Sea

![Shallow Sea](shallow-sea/preview.webp)

An interactive tropical shore seen from above. Waves come in sets and wash up the beach, the water deepens from clear shallows through turquoise to deep blue, and fish, rays, sea turtles and jellyfish swim through it, with a pod of dolphins passing now and then. Everything is rendered live in WebGL2. It runs as a desktop wallpaper in [Lively Wallpaper](https://github.com/rocksdanister/lively) on Windows, or in any browser, phones included.

**Play it in your browser: <https://lego514.github.io/shallow-sea/>** — the gear in the bottom-right corner opens the settings (English or 中文).

[中文說明](#中文說明)

## Install as a wallpaper

1. Install [Lively Wallpaper](https://github.com/rocksdanister/lively).
2. Download `ShallowSea-Lively.zip` from the [latest release](https://github.com/Lego514/shallow-sea/releases/latest).
3. Drag the zip into the Lively window (or use **+ Add Wallpaper** and pick the zip), then click it to apply.

Open **Customise** on the wallpaper in Lively to change the settings below.

> Lively's **Wallpaper input** setting must be **Mouse** (the default) for the wallpaper to react to your mouse.

### Wallpaper Engine

1. Download `ShallowSea-WallpaperEngine.zip` from the [latest release](https://github.com/Lego514/shallow-sea/releases/latest).
2. Extract it into `…\steamapps\common\wallpaper_engine\projects\myprojects\`, so that a `shallow-sea` folder appears there.
3. Restart Wallpaper Engine; Shallow Sea is listed under **Installed**. Its settings are in the panel on the right.

Wallpaper Engine has no buttons in its settings, so **New seabed** and **Show seabed number** are switches: flip one to make it happen. Wallpaper Engine's own frame-rate limit and pause are respected.

> The Wallpaper Engine version follows Wallpaper Engine's documented web-wallpaper API but hasn't been tried inside Wallpaper Engine yet. If something doesn't work, please [open an issue](https://github.com/Lego514/shallow-sea/issues).

## What you can do

| Action | What happens |
| --- | --- |
| Move the mouse over the water | Draws a trail of ripples; the light patterns on the seabed bend with them |
| Click | A splash with rings of light; fish scatter and floating flowers drift away |
| Press and drag | Like putting your hand in the water: bigger waves |
| Press and drag on the sand | Write or draw with your finger; the next wave smooths it away |
| Hold the mouse button still on the water | Sprinkles fish food: it floats, then slowly sinks, and the fish rush over to eat it (a stingray cleans up what reaches the bottom) |
| Hold the cursor still | Curious little fish gather around it |
| Go near a hermit crab | It pulls back into its shell, then carries on, leaving tiny footprints |
| Click right beside the dolphins | Startled, one leaps clear of the water and crashes back in with a burst of whitewater |
| At night | A path of moonlight glitters on the ripples out over the deep water. Touching the water lights up glowing plankton; jellyfish and breaking surf glow. Now and then a nest of turtle hatchlings breaks open on the beach and they scramble down to the sea, leaving tiny tracks (they freeze if you sweep the cursor over them) |
| Nothing at all | Waves arrive in sets and at an angle: the swell slows and steepens in the shallows (focusing a bright band of light on the sand), breaks into whitewater, runs up the beach and drains back in streaks of foam, leaving a foam line at the top; wet sand darkens and the churned water clouds for a moment |

## Settings

- **Time of day**: follows your clock (morning, noon, sunset and night blend into each other), or stays at one time.
- **Beach**: top left (default), top, top right, left, right, bottom, or open shallows with no beach.
- **Shallow / deep water colour**: how clear the shallows are, and the blue the deep water fades into.
- **New seabed** and **fixed seabed number**: every start makes a new seabed; to keep one you like, use its number.
- **Tides**: the sea rises and falls with real time, about every 12.4 hours, so the beach widens and narrows.
- Caustic light, wave size and speed, mouse ripples, rain, cloud shadows.
- Small fish, big fish, rays, sea turtles (green, hawksbill, olive ridley), **dolphins**, jellyfish, hermit crabs & gulls, **turtle hatchlings**, floating flowers & leaves, **feed the fish**.
- **Wave sounds** (off by default) and **volume**: surf in step with the picture, and a plop when you tap the water.
- **Save power when idle** (on by default): after 45 seconds without the mouse it drops to 30 FPS, and is back to full speed as soon as the mouse moves.
- **Quality** and **limit to 30 FPS**: turn these down on a slow graphics card or on battery.

Lively itself can pause the wallpaper entirely: in Lively's **Settings → Performance**, choose what happens while a fullscreen app runs, while another app has focus, and on battery.

## Files

```
shallow-sea/
  index.html             entry point used by Lively
  web.html               the web version: the same scene plus a settings panel (English / 中文)
  sea.js                 all of the simulation and shaders
  LivelyInfo.json        wallpaper info for Lively
  LivelyProperties.json  Lively's Customise panel (the web settings panel reads it too)
  project.json           the same settings for Wallpaper Engine (run `python tools/make_project_json.py` after changing LivelyProperties.json)
  thumbnail.jpg / preview.jpg / preview.gif / preview.webp   pictures for Lively and this README
.github/workflows/pages.yml   publishes the web version to GitHub Pages on every push to main
```

To package the wallpaper yourself, zip `index.html`, `sea.js`, `LivelyInfo.json`, `LivelyProperties.json`, `thumbnail.jpg`, `preview.jpg` and `preview.gif` from `shallow-sea/` with the files at the top level of the zip.

## Run it locally

```bash
python -m http.server 8765 --directory shallow-sea
```

Open `http://localhost:8765/` (wallpaper version) or `http://localhost:8765/web.html` (web version). URL parameters: `?hour=21` (time of day), `?seed=123` (fixed seabed), `?shore=3` (beach position, 0–6), `?tide=0.05` (tide level), `?debug` (FPS counter), `?view=1` (caustics only), `?view=2` (seabed only), `?view=3` (depth map).

## How it works

- **Seabed**: generated procedurally (beach, sand ripples, seagrass, rocks, pebbles, shells, starfish) and baked into a texture once per seabed; the alpha channel holds water depth, negative on the beach. Light is absorbed with depth, red first, so the water shades from clear to turquoise to the scattered blue of deep water.
- **Waves on the beach**: the coastline is baked into a coordinate map. Each wave has its own size (they come in sets), arrival time and angle, and every pixel tracks the latest four: the swell travels at √depth, breaks where its height says it should, slows as it runs up the sand and speeds up as it drains. From that the shader works out whether the sand is covered, how thick and how old the foam is, and how wet the sand is. The swell's curvature also feeds the caustics.
- **Water surface**: ten analytic wind waves plus a GPU height-field simulation for the ripples made by the mouse, rain, fish and floating things.
- **Caustics**: for each point on the seabed the shader finds which surface point refracted the sunlight there; brightness is 1 / |det| of the refraction map's Jacobian, so your ripples cast matching rings of light on the sand.
- **Sea life**: small silver-flanked fish school as boids (flashing as they turn), big fish roam alone (a yellow tang, a sergeant major, a bluefin trevally), a blue-spotted stingray rests on the shallow sand, an eagle ray and a manta fly through the water, green, hawksbill and olive ridley turtles drift by and surface to breathe (each arrival may be a different species: the hawksbill with its tortoiseshell and serrated shell, the small, round, plain olive ridley), every few minutes a pod of bottlenose dolphins crosses the deep water in formation (each one rising to breathe in turn, now and then one leaping clear of the water and crashing back in, scattering the fish), moon jellies (four lilac horseshoe gonads) and striped sea nettles trailing their tentacles pulse along in deeper water. All are drawn as signed-distance shapes and cast shadows along the refracted sun direction.

## License

[MIT](LICENSE) — free to use, change and share; keep the copyright notice.

---

## 中文說明

從正上方看下去的一段熱帶海岸：浪一組一組沖上沙灘，海水從清澈的淺水、土耳其藍漸層到深藍色；魚群、魟魚、海龜（綠蠵龜、玳瑁、欖蠵龜）和水母在裡面游，偶爾還有一群海豚經過，有時會躍出水面。全部用 WebGL2 即時運算，可以當 Windows 上 [Lively Wallpaper](https://github.com/rocksdanister/lively) 的桌布，也可以直接在瀏覽器（含手機）玩。

**線上玩：<https://lego514.github.io/shallow-sea/>**（右下角齒輪可以調設定、切換中文／English）

### 安裝成桌布

1. 安裝 [Lively Wallpaper](https://github.com/rocksdanister/lively)。
2. 到 [Releases](https://github.com/Lego514/shallow-sea/releases/latest) 下載 `ShallowSea-Lively.zip`。
3. 把 zip 拖進 Lively 視窗（或按「＋ 新增桌布」選這個 zip），再點它套用。

在 Lively 的桌布上按「自訂」可以調整設定。Lively 設定裡的「桌布輸入」要是「滑鼠」（預設就是），桌布才收得到滑鼠。

**Wallpaper Engine**：到 Releases 下載 `ShallowSea-WallpaperEngine.zip`，解壓到 `…\steamapps\common\wallpaper_engine\projects\myprojects\`（會多一個 `shallow-sea` 資料夾），重開 Wallpaper Engine 後在「已安裝」裡就找得到。Wallpaper Engine 的設定沒有按鈕，所以「換一片海床」「顯示海床編號」是開關，切換一次就會執行。這個版本是照 Wallpaper Engine 的官方文件做的，還沒在 Wallpaper Engine 裡實際測過，有問題歡迎開 issue。

### 互動

| 動作 | 效果 |
| --- | --- |
| 滑鼠劃過水面 | 拖出一道漣漪，海床上的光紋跟著扭動 |
| 點一下 | 濺起水花、一圈圈擴散的光環；魚會四散，漂浮的花葉被推開 |
| 按住拖曳 | 像把手伸進水裡，水波更大 |
| 在沙灘上按住拖曳 | 用手指在沙上寫字、畫圖；浪沖上來時會把它抹平 |
| 在水面上按住滑鼠不動 | 撒飼料：先浮在水面，再慢慢沉下去，魚會衝過來搶食（沉到底的會被藍點魟吃掉） |
| 游標停著不動幾秒 | 好奇的小魚會慢慢游過來繞著游標 |
| 靠近寄居蟹 | 牠會縮進殼裡，過幾秒才探出頭繼續爬，沿路留下小腳印 |
| 在海豚旁邊點一下 | 受驚的海豚會躍出水面，再「啪」一聲濺起白浪落回水裡 |
| 晚上 | 深水區的海面上有一條閃爍的月光路。碰到海水的地方會亮起藍色螢光浮游生物；水母和浪花也會發光。偶爾沙灘上會有一窩小海龜孵化，一路爬向大海、留下小小的爬痕（游標掃過時牠們會停住不動） |
| 什麼都不做 | 浪一組一組、斜斜地打進來：湧浪在淺水裡變慢變陡，碎成白浪沖上沙灘，再拖著泡沫條紋退回去，最高處留下一道泡沫線 |

### 設定

- **時段**：自動跟系統時鐘，或固定一個時段
- **沙灘位置**：左上角（預設）、上方、右上角、左側、右側、下方，或沒有沙灘的整片淺海
- **淺水顏色／深海顏色**
- **重新產生海床／固定海床編號**：每次啟動都是新的一片；喜歡現在這片就把編號填進去
- **潮汐**：照真實時間大約每 12.4 小時漲退一次
- 光紋強度、波浪大小／速度、滑鼠漣漪強度、雨、雲影
- 小魚數量、大魚、魟魚、海龜（三種）、**海豚**、水母數量、寄居蟹與海鷗、**小海龜孵化**、漂浮的花與葉、**餵魚**
- **海浪聲**（預設關閉）與**音量**
- **閒置時省電**（預設開）：滑鼠 45 秒沒動就降到 30 FPS，一動馬上恢復
- **畫質／鎖定 30 FPS**：顯示卡較弱或用電池時可以調低

Lively 本身也能讓桌布完全暫停：在 Lively 的「設定 → 效能」可以設定有全螢幕程式、其他程式在前景、用電池時要不要暫停。

### 授權

[MIT](LICENSE)：可以自由使用、修改、分享，保留版權聲明即可。
