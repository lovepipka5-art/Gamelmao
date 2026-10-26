import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const recent = [];
const MAX_RECENT = 150;

const DEMOS = [
  {
    id: "demo-1",
    title: "Твой кот становится гением",
    setup: "Он понимает экономику, философию и квантовую физику — и каждое утро объясняет, почему ты живёшь неправильно.",
    a: { label: "Он становится твоим личным консультантом", benefit: "Любая сложная проблема решается за пять минут.", cost: "Каждый совет заканчивается фразой: «Я бы на твоём месте хотя бы не ел так позорно»." },
    b: { label: "Он сохраняет обычный кошачий интеллект", benefit: "Дома по-прежнему спокойно, уютно и никто не критикует твою жизнь.", cost: "Ты навсегда узнаёшь, что кот способен говорить, но лично с тобой принципиально не разговаривает." },
    category: "Абсурд",
    spice: 3
  },
  {
    id: "demo-2",
    title: "Ты можешь выиграть любой спор",
    setup: "Даже если ты несёшь полную чушь, собеседник в итоге признаёт твою правоту.",
    a: { label: "Ты всегда побеждаешь в споре", benefit: "Никто больше не может выставить тебя идиотом в дискуссии.", cost: "После каждой победы появляется хор из трёх пенсионеров и поёт гимн твоей неправоте." },
    b: { label: "Ты всегда знаешь правильный ответ", benefit: "Ты больше никогда не ошибаешься в фактах.", cost: "Как только ты открываешь рот, звучит вступление к документальному фильму о том, как скучно с тобой общаться." },
    category: "Социальный позор",
    spice: 2
  },
  {
    id: "demo-3",
    title: "Идеальный флирт — твой",
    setup: "Ты безошибочно понимаешь, что сказать, чтобы понравиться человеку.",
    a: { label: "Любой флирт срабатывает", benefit: "Ты можешь очаровать практически любого подходящего взрослого человека.", cost: "Сразу после удачной фразы ты делаешь победный звук кассового аппарата." },
    b: { label: "Ты читаешь романтические сигналы", benefit: "Ты точно знаешь, есть ли взаимный интерес.", cost: "Каждый отказ сопровождается всплывающим уведомлением: «Заявка отклонена. Причина: ну нет»." },
    category: "Отношения",
    spice: 4
  },
  {
    id: "demo-4",
    title: "Твоё тело получает обновление",
    setup: "Ты можешь выбрать одну сверхспособность организма, которая работает всю жизнь.",
    a: { label: "Ты никогда не болеешь", benefit: "Любые болезни обходят тебя стороной.", cost: "При каждом чихе ты произносишь имя последнего человека, который тебя бесил." },
    b: { label: "Ты можешь есть что угодно", benefit: "Никаких аллергий, ограничений и пищевых последствий.", cost: "После каждого приёма пищи ты обязан провести TED Talk о том, почему именно эта еда изменила человечество." },
    category: "Физиология",
    spice: 3
  },
  {
    id: "demo-5",
    title: "Тебе доступен идеальный двойник",
    setup: "Двойник может выполнять за тебя любую бытовую задачу, пока ты отдыхаешь.",
    a: { label: "Двойник делает всю скучную работу", benefit: "У тебя появляется бесконечно много свободного времени.", cost: "Он постоянно выкладывает ваши совместные фото с подписью «Опять тащу этого бездельника»." },
    b: { label: "Двойник ходит вместо тебя на неудобные встречи", benefit: "Больше никаких неловких разговоров и обязательных мероприятий.", cost: "Он настолько обаятельный, что все твои друзья начинают приглашать только его." },
    category: "Жизненный хаос",
    spice: 2
  }
];

function normalize(s = "") {
  return s.toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprint(d) {
  return crypto.createHash("sha256")
    .update(normalize([d.title, d.setup, d.a?.label, d.a?.benefit, d.a?.cost, d.b?.label, d.b?.benefit, d.b?.cost].join(" ")))
    .digest("hex");
}

function overlap(a, b) {
  const wa = new Set(normalize(a).split(" ").filter(w => w.length > 3));
  const wb = new Set(normalize(b).split(" ").filter(w => w.length > 3));
  if (!wa.size || !wb.size) return 0;
  let n = 0;
  for (const w of wa) if (wb.has(w)) n++;
  return n / Math.max(wa.size, wb.size);
}

function qualityCheck(d) {
  const errors = [];
  if (!d || typeof d !== "object") return { ok: false, errors: ["invalid_json"] };
  for (const k of ["title", "setup", "a", "b", "category"]) {
    if (!d[k]) errors.push(`missing_${k}`);
  }
  for (const side of ["a", "b"]) {
    if (!d[side]?.label || !d[side]?.benefit || !d[side]?.cost) errors.push(`incomplete_${side}`);
  }
  const texts = [d.title, d.setup, d.a?.label, d.a?.benefit, d.a?.cost, d.b?.label, d.b?.benefit, d.b?.cost].filter(Boolean);
  if (texts.some(t => String(t).length > 360)) errors.push("too_long");
  if (d.a && d.b) {
    if (normalize(d.a.label) === normalize(d.b.label)) errors.push("same_choice");
    if (overlap(d.a.label + " " + d.a.benefit + " " + d.a.cost, d.b.label + " " + d.b.benefit + " " + d.b.cost) > 0.78) errors.push("too_similar");
  }
  const all = normalize(texts.join(" "));
  const generic = ["ты получаешь миллион", "каждый раз когда ты врешь", "читаешь мысли всех", "диарея", "переписки с мамой"];
  if (generic.some(x => all.includes(normalize(x)))) errors.push("cliche_or_duplicate_theme");
  const hasBenefit = Boolean(d.a?.benefit && d.b?.benefit);
  const hasCost = Boolean(d.a?.cost && d.b?.cost);
  if (!hasBenefit || !hasCost) errors.push("no_real_tradeoff");
  return { ok: errors.length === 0, errors };
}

function remember(d) {
  recent.unshift({
    fingerprint: fingerprint(d),
    text: [d.title, d.setup, d.a?.label, d.a?.benefit, d.a?.cost, d.b?.label, d.b?.benefit, d.b?.cost].join(" "),
    at: Date.now()
  });
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
}

function isDuplicate(d) {
  const fp = fingerprint(d);
  if (recent.some(x => x.fingerprint === fp)) return true;
  const current = [d.title, d.setup, d.a?.label, d.a?.benefit, d.a?.cost, d.b?.label, d.b?.benefit, d.b?.cost].join(" ");
  return recent.some(x => overlap(current, x.text) > 0.72);
}

const SYSTEM_PROMPT = `Ты — главный автор абсурдной комедийной игры «Ну и выбор».
Создавай ОДНУ новую дилемму на русском языке. Юмор: смешанный — сюрреалистичный абсурд, пошлые намёки без графических сексуальных подробностей, социальный позор и морально неприятные решения.
Обязательные требования:
- У каждой из двух опций есть конкретная желанная выгода И конкретная смешная/неприятная цена.
- Обе опции должны быть реально привлекательны и реально неприятны; ни одна не должна быть очевидно правильной. Это не две одинаково плохие вещи.
- Ситуация конкретная, визуальная и легко представимая; юмор строится на неожиданном повороте, а не на случайном наборе слов.
- Не используй деньги как основной приз/наказание.
- Не используй банальные повторы: диарея по расписанию, чтение мыслей с утечкой мыслей, публичные субтитры мыслей, неловкие переписки с мамой, голос Микки Мауса, имя бывшего при сексе, пукающие голуби, просто неприятный запах.
- Не повторяй смысл прошлых дилемм. Меняй комедийный механизм, тип выгоды, социальную среду и цену.
- Все участники — взрослые. Не делай насилие, унижение защищённых групп или сексуальное принуждение центральной шуткой.
- Коротко: заголовок до 8 слов, вводная до 35 слов, каждая выгода и цена до 25 слов.
Верни только валидный JSON по схеме:
{"title":"...","setup":"...","a":{"label":"...","benefit":"...","cost":"..."},"b":{"label":"...","benefit":"...","cost":"..."},"category":"Абсурд|Отношения|Социальный позор|Физиология|Моральная дилемма|Жизненный хаос","spice":1}
spice — целое число от 1 до 5.`;

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mode: client ? "ai" : "demo", model: client ? MODEL : null });
});

app.get("/api/dilemma", (_req, res) => {
  const d = DEMOS[Math.floor(Math.random() * DEMOS.length)];
  res.json({ ...d, mode: "demo" });
});

app.post("/api/dilemma", async (req, res) => {
  if (!client) {
    const d = DEMOS[Math.floor(Math.random() * DEMOS.length)];
    return res.json({ ...d, mode: "demo", notice: "Добавьте OPENAI_API_KEY в .env, чтобы включить генерацию ИИ." });
  }

  const avoid = recent.slice(0, 25).map(x => x.text.slice(0, 280));
  const requestedCategory = typeof req.body?.category === "string" ? req.body.category.slice(0, 50) : "любая";
  const lastSeen = Array.isArray(req.body?.seen) ? req.body.seen.slice(-12).map(x => String(x).slice(0, 180)) : [];
  let lastErrors = [];

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        temperature: Math.min(1.15, 1.0 + attempt * 0.05),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Категория: ${requestedCategory}.
Не повторяй и не перефразируй эти недавние дилеммы:
${[...avoid, ...lastSeen].join("\n---\n") || "История пока пуста."}
Попытка: ${attempt + 1}. Сделай неожиданно смешно, но логично. Проверь, что обе опции имеют ощутимую выгоду и цену. Верни JSON.` }
        ]
      });
      const raw = response.choices?.[0]?.message?.content || "{}";
      const d = JSON.parse(raw);
      const qc = qualityCheck(d);
      if (!qc.ok) { lastErrors = qc.errors; continue; }
      if (isDuplicate(d)) { lastErrors = ["semantic_duplicate"]; continue; }
      remember(d);
      return res.json({ ...d, id: crypto.randomUUID(), mode: "ai" });
    } catch (err) {
      console.error("Dilemma generation error:", err?.message || err);
      return res.status(502).json({ error: "generation_failed", message: "ИИ временно не смог придумать достойную дилемму. Попробуйте ещё раз." });
    }
  }
  return res.status(502).json({
    error: "quality_gate_failed",
    message: "Не получилось найти достаточно оригинальную дилемму. Попробуйте ещё раз.",
    checks: lastErrors
  });
});

app.listen(PORT, () => {
  console.log(`Ну и выбор запущен: http://localhost:${PORT}`);
  console.log(client ? `AI generation enabled (${MODEL})` : "Demo mode: set OPENAI_API_KEY in .env to enable AI");
});
