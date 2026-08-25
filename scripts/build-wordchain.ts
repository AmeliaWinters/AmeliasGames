/**
 * Build the three word lists Word Chain plays on, into
 * `src/shared/games/chainWords.ts`.
 *
 *   npm run build:wordchain
 *
 * Nothing here runs at play time. This exists because the game needs three
 * things per word that no single public source carries together (is it a word,
 * how common is it, what does it mean in English) and stitching them is a job
 * for a script that runs once, not for a reducer.
 *
 * Why each source:
 *
 * - **hermitdave/FrequencyWords** (CC-BY-SA 4.0) gives the *ordering*, from
 *   OpenSubtitles. Order is not decoration: when a player's minute runs out
 *   the game reveals the commonest word they could have played, and "commonest"
 *   has to come from somewhere. It also doubles as the "is this a word people
 *   actually say" filter, which a dictionary alone will not do, since
 *   `words.ts` happily contains `aal` and `abb`.
 * - **PoliMorf 2.1** (BSD) maps Polish inflected forms to lemmas. Without it
 *   the Polish glosses are useless: the frequency list is full of `jest`,
 *   `jestem`, `będzie` and the dictionary only knows `być`, so gloss coverage
 *   over the top 500 was 48%. Through the lemma bridge it is 95%.
 * - **FreeDict pol-eng** (CC-BY-SA 3.0, from Wiktionary via WikDict) glosses
 *   the Polish lemmas.
 * - **EDICT2** (CC-BY-SA 4.0, EDRDG) carries Japanese headword, reading and
 *   English gloss in one entry, so Japanese needs no separate bridge. Its
 *   `(P)` marker, JMdict's own ichi1/news1/spec1 priority, is a better
 *   commonness signal than the frequency list, which is MeCab-tokenised and so
 *   ranks bare particles at the top.
 *
 * The sources are cached under `.cache/wordchain/` and that directory is
 * gitignored: it is 350MB, almost all of it PoliMorf, and re-fetching it is a
 * once-a-year event. Two of the six are archives this script does not unpack
 * itself; see `SOURCES`.
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

const CACHE = '.cache/wordchain';
const OUT = 'src/shared/games/chainWords.ts';

/**
 * The shortest word the game will take, in every language.
 *
 * Three, not two, and the reason is the same in all three: two-letter words
 * are function words. Polish `to`, `na`, `za`, `go`; Japanese single mora like
 * `no` and `ga`; English `of`, `an`. They are the commonest words in each
 * language, so an unbounded chain becomes two players trading particles, and
 * they are the words a gloss serves worst: Polish `się` is a reflexive marker
 * and Japanese `no` is a genitive particle, neither of which has a translation
 * so much as a footnote. Three letters is where words start meaning things.
 */
const MIN_LENGTH = 3;

/**
 * How many words each language contributes, and how far down the Polish list a
 * gloss is worth its bytes.
 *
 * These are a *size* budget, not a linguistic one. The worker was 1389 KiB
 * gzipped before this game existed and is meant to stay comfortably under
 * 2.2MB, which leaves about 860 KiB. Truncation is safe precisely because the
 * lists are frequency-ordered, so it removes the rarest words and the reveal
 * reads from the top.
 *
 * Japanese is capped hardest for a reason that is not linguistic either: kana
 * and kanji are three bytes each in UTF-8 and compress far worse than Latin
 * text, so its 18,850 entries cost 368 KiB against Polish's 45,189 for 351.
 *
 * English is the one that was widened last, from 25,000 to 50,000, and it is
 * the reason `PL_GLOSS_DEPTH` is no longer 20,000. Doubling it costs 101 KiB
 * gzipped, 91 for the old list and 192 for the new, and the worker was at 2160
 * of the 2253 available, so it did not fit. It was paid for out of the Polish
 * glosses, which are the cheapest thing in this file per word of playable
 * vocabulary lost: none. 20,000 -> 12,000 gave back 63 KiB and left the worker
 * at 2198.
 *
 * Polish's cap is a rail rather than a budget. Its list runs to about 64,600
 * and most of that is the zero-weight dictionary block, which is alphabetical
 * and therefore nearly free: taking all of it costs 161 KiB gzipped and
 * leaves the worker at 2153 of the 2253 available. The cap cannot usefully be
 * set *inside* that block anyway, because alphabetical order means cutting it
 * short cuts by letter: 55,000 would be a list that has stopped at S.
 *
 * `PL_GLOSS_DEPTH` is where the real Polish budget went, and it is why the cap
 * can be so loose. Glosses are what cost: at 20,000 the worker is 2153 KiB, at
 * 40,000 it is 2299 and at no limit at all it is 2479, so glossing the whole
 * list is roughly 330 KiB the ceiling does not have. Words below the depth are
 * still playable, and the reveal only ever reads from above it, which is why
 * this rather than a word cap is where a widening elsewhere gets paid for. It
 * came down to 12,000 to buy English its second twenty-five thousand words;
 * 9,916 of the 64,635 Polish words are glossed at that depth. The words
 * between 12,000 and 20,000 are still there and still playable, they simply
 * arrive without their English meaning if anyone reaches that far down.
 */
const LIMIT = { pl: 70_000, ja: 12_000, en: 50_000 } as const;
const PL_GLOSS_DEPTH = 12_000;

/**
 * How far into the English list counts as "common English" when Polish is
 * deciding whether a word is really a borrowing. See `buildPolish`.
 *
 * Pinned to where the English list used to stop rather than following it. That
 * filter drops an unglossed Polish word for looking like an English one, and
 * it is only honest about words an English speaker would recognise on sight:
 * past twenty-five thousand the English list is into `haddo` and `askar`, and
 * a Polish word colliding with one of those is a coincidence, not a borrowing.
 */
const EN_COMMON = 25_000;

const SOURCES: Record<string, { url: string; note?: string }> = {
  'pl_50k.txt': { url: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/pl/pl_50k.txt' },
  // The full list, not the 50k one, because the 50k one is fifty thousand
  // *strings* and barely half of them survive the `words.ts` filter: it tops
  // out around 27,000 real words, short of the 50,000 the game wants.
  // 20MB, and the cache is gitignored.
  'en_full.txt': { url: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt' },
  // 2018 has no `ja`; 2016 does.
  'ja_50k.txt': { url: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2016/ja/ja_50k.txt' },
  'edict2u.txt': { url: 'http://ftp.edrdg.org/pub/Nihongo/edict2u.gz', note: 'gz' },
  'polimorfologik-2.1.txt': {
    url: 'https://github.com/morfologik/polimorfologik/releases/download/2.1/polimorfologik-2.1.zip',
    note: 'zip: unpack polimorfologik-2.1.txt out of it',
  },
  'pol-eng/pol-eng.index': {
    url: 'https://download.freedict.org/dictionaries/pol-eng/2024.10.10/freedict-pol-eng-2024.10.10.dictd.tar.xz',
    note: 'tar.xz: unpack the pol-eng/ directory, then gunzip pol-eng.dict.dz',
  },
};

async function ensure(name: string): Promise<string> {
  const path = join(CACHE, name);
  if (existsSync(path)) return path;
  const src = SOURCES[name];
  if (!src) throw new Error(`no source registered for ${name}`);
  if (src.note?.startsWith('zip') || src.note?.startsWith('tar')) {
    throw new Error(`${path} is missing. Fetch ${src.url} and ${src.note}.`);
  }
  mkdirSync(CACHE, { recursive: true });
  process.stderr.write(`fetching ${name}\n`);
  const body = Buffer.from(await (await fetch(src.url)).arrayBuffer());
  writeFileSync(path, src.note === 'gz' ? gunzipSync(body) : body);
  return path;
}

/** `word count` per line, most frequent first. Rank is the line number. */
function frequency(text: string): Map<string, number> {
  const out = new Map<string, number>();
  text.split('\n').forEach((line, i) => {
    const w = line.split(' ')[0]?.trim();
    if (w && !out.has(w)) out.set(w, i);
  });
  return out;
}

/**
 * The same file read for its counts rather than its order.
 *
 * Rank is enough for English, where a word is mostly one string. It is not
 * enough for Polish, where a noun's occurrences are split between seven cases
 * and two numbers, so each of its forms ranks far below where the word itself
 * belongs. See `weighPolish`.
 */
function counts(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split('\n')) {
    const [w, n] = line.trim().split(' ');
    if (w && n && !out.has(w)) out.set(w, Number(n));
  }
  return out;
}

/* ------------------------------------------------------------------ Japanese */

const MONO: Record<string, string> = {
  あ:'a',い:'i',う:'u',え:'e',お:'o',
  か:'ka',き:'ki',く:'ku',け:'ke',こ:'ko', が:'ga',ぎ:'gi',ぐ:'gu',げ:'ge',ご:'go',
  さ:'sa',し:'shi',す:'su',せ:'se',そ:'so', ざ:'za',じ:'ji',ず:'zu',ぜ:'ze',ぞ:'zo',
  た:'ta',ち:'chi',つ:'tsu',て:'te',と:'to', だ:'da',ぢ:'ji',づ:'zu',で:'de',ど:'do',
  な:'na',に:'ni',ぬ:'nu',ね:'ne',の:'no',
  は:'ha',ひ:'hi',ふ:'fu',へ:'he',ほ:'ho', ば:'ba',び:'bi',ぶ:'bu',べ:'be',ぼ:'bo',
  ぱ:'pa',ぴ:'pi',ぷ:'pu',ぺ:'pe',ぽ:'po',
  ま:'ma',み:'mi',む:'mu',め:'me',も:'mo',
  や:'ya',ゆ:'yu',よ:'yo', ら:'ra',り:'ri',る:'ru',れ:'re',ろ:'ro',
  わ:'wa',ゐ:'i',ゑ:'e',を:'o',ん:'n', ゔ:'vu',
  ぁ:'a',ぃ:'i',ぅ:'u',ぇ:'e',ぉ:'o',ゃ:'ya',ゅ:'yu',ょ:'yo',ゎ:'wa',
};
const DIGRAPH: Record<string, string> = {
  きゃ:'kya',きゅ:'kyu',きょ:'kyo', ぎゃ:'gya',ぎゅ:'gyu',ぎょ:'gyo',
  しゃ:'sha',しゅ:'shu',しょ:'sho', じゃ:'ja',じゅ:'ju',じょ:'jo',
  ちゃ:'cha',ちゅ:'chu',ちょ:'cho', ぢゃ:'ja',ぢゅ:'ju',ぢょ:'jo',
  にゃ:'nya',にゅ:'nyu',にょ:'nyo', ひゃ:'hya',ひゅ:'hyu',ひょ:'hyo',
  びゃ:'bya',びゅ:'byu',びょ:'byo', ぴゃ:'pya',ぴゅ:'pyu',ぴょ:'pyo',
  みゃ:'mya',みゅ:'myu',みょ:'myo', りゃ:'rya',りゅ:'ryu',りょ:'ryo',
  ふぁ:'fa',ふぃ:'fi',ふぇ:'fe',ふぉ:'fo', うぃ:'wi',うぇ:'we',うぉ:'wo',
  ゔぁ:'va',ゔぃ:'vi',ゔぇ:'ve',ゔぉ:'vo', てぃ:'ti',でぃ:'di',とぅ:'tu',どぅ:'du',
  しぇ:'she',じぇ:'je',ちぇ:'che', つぁ:'tsa',つぃ:'tsi',つぇ:'tse',つぉ:'tso',
};

/** Katakana sit exactly 0x60 above their hiragana in Unicode. */
const toHiragana = (s: string) =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/**
 * Hepburn, enough of it for a word list. Returns null for anything that is not
 * kana, which is the filter as much as the failure: an EDICT entry whose
 * reading will not romanise is one this game has no way to let a player type.
 */
function romanise(kana: string): string | null {
  const s = toHiragana(kana);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const two = DIGRAPH[s.slice(i, i + 2)];
    if (two) { out += two; i++; continue; }
    const c = s[i]!;
    if (c === 'っ') {
      // Sokuon doubles the next consonant, except before `ch`, where Hepburn
      // writes `t`: 抹茶 is matcha, not maccha.
      const next = DIGRAPH[s.slice(i + 1, i + 3)] ?? MONO[s[i + 1]!];
      if (next) out += next.startsWith('ch') ? 't' : next[0];
      continue;
    }
    if (c === 'ー') { out += out.at(-1) ?? ''; continue; }
    const one = MONO[c];
    if (one === undefined) return null;
    out += one;
  }
  return out;
}

/** Grammatical furniture and register markers, not words to chain on. */
const JA_SKIP = /\((prt|suf|pref|ctr|aux|cop|arch|obs|obsc|derog|vulg|X)[,)]/;

/** EDICT stacks metadata in front of the gloss: `(v5r,vt) (1) (uk) to rub in`. */
function firstGloss(senses: string): string {
  for (const raw of senses.split('/')) {
    if (!raw || /^Ent[LP]\d/.test(raw) || raw === '(P)') continue;
    // EDICT parks loanword etymologies at the end of a gloss, as in
    // "coffee (eng: coffee, dut: koffie)", which teaches nobody anything.
    let s = raw.replace(/\{[^}]*\}/g, '').replace(/\s*\([a-z]{3}:[^)]*\)/g, '').trim();
    for (let prev = ''; s !== prev; ) { prev = s; s = s.replace(/^\([^)]*\)\s*/, '').trim(); }
    if (s && !s.startsWith('(')) return s;
  }
  return '';
}

interface JaWord { romaji: string; kana: string; kanji: string; gloss: string }

function buildJapanese(edict: string, freq: Map<string, number>): JaWord[] {
  const best = new Map<string, { row: JaWord; score: number }>();
  for (const line of edict.split('\n').slice(1)) {
    if (!line.trim() || !line.includes('(P)')) continue;
    const m = /^([^ ]+)(?: \[([^\]]+)\])? \/(.*)\/$/.exec(line.trim());
    if (!m) continue;
    const [, headRaw, readRaw, senses] = m as unknown as [string, string, string | undefined, string];
    if (JA_SKIP.test(senses)) continue;
    const kanji = headRaw.split(';')[0]!.replace(/\([^)]*\)/g, '');
    const kana = (readRaw ?? kanji).split(';')[0]!.replace(/\([^)]*\)/g, '');
    if (!/^[぀-ヿー]+$/.test(kana)) continue;
    const romaji = romanise(kana);
    if (!romaji || romaji.length < MIN_LENGTH || romaji.length > 14) continue;
    const gloss = firstGloss(senses);
    if (!gloss || gloss.length > 44) continue;
    // Homographs: 擦る and 為る are both `suru`, and 箆 and の are both `no`.
    // The everyday word is the one that has accreted senses; the obscure one
    // has two. Weighting the sense count against the rank picks better than
    // either does alone, and better than EDICT's file order, which is
    // alphabetical and means nothing.
    const senseCount = senses.split('/').filter((s) => /^(\([a-z0-9,-]+\) )?\(\d+\)/.test(s)).length || 1;
    const score = (freq.get(kanji) ?? freq.get(kana) ?? 60_000) - senseCount * 40;
    const prev = best.get(romaji);
    if (!prev || score < prev.score) {
      best.set(romaji, { row: { romaji, kana, kanji: kanji === kana ? '' : kanji, gloss }, score });
    }
  }
  return [...best.values()].sort((a, b) => a.score - b.score).map((e) => e.row);
}

/* -------------------------------------------------------------------- Polish */

/**
 * The top of the Polish list, glossed by hand.
 *
 * These are the words a player meets every game, and they are exactly the ones
 * WikDict gets worst, because a high-frequency Polish word is usually a
 * function word and Wiktionary's entry for it is a grammatical essay rather
 * than a translation. Left to the automatic pass, `mnie` came out as "pierwsza
 * osoba liczby pojedynczej" (the Polish definition, verbatim), `ale` as the
 * beer, `go` as the board game, `nas` as NASA and `mam` as "mother", the last
 * because `mam` lemmatises to both `mama` and `mieć` and nothing said which.
 *
 * So this table wins over everything below it. It is also the honest form of
 * the "hundred most common Polish words" this game was asked for: a hundred
 * words with a translation somebody checked.
 *
 * Two-letter entries are absent on purpose: `to`, `na`, `za`, `go` and the
 * rest are unplayable under MIN_LENGTH, so glossing them would be dead weight.
 *
 * The second block is perfective verbs, and it is here because of `weighPolish`
 * rather than because of Wiktionary. Rolling a verb's forms up onto its lemma
 * put thirty-odd infinitives into the commonest five hundred words, where they
 * belong and where they had never been before, and WikDict has an entry for
 * almost none of them, because a Polish dictionary lists the imperfective and
 * leaves the reader to derive its pair. `wracać` is in there; `wrócić`, which
 * is the form people say, is not.
 */
const PL_OVERRIDE = `
nie=not, no          się=-self (reflexive)   tak=yes; so           jak=how; as, like
ale=but              mnie=me                 tym=this (inst./loc.) tego=this, that (gen.)
tylko=only, just     czy=whether, if         może=maybe; can       jestem=I am
cię=you (acc.)       mam=I have              jesteś=you are        już=already
jeśli=if             dla=for                 wiem=I know           coś=something
dobrze=well, fine    więc=so, therefore      teraz=now             pan=sir, Mr, gentleman
wszystko=everything  być=to be               będzie=will be        masz=you have
nic=nothing          tam=there               mogę=I can            proszę=please; here you are
jej=her, hers        gdzie=where             kiedy=when            ten=this
ciebie=you (gen.)    sobie=oneself           był=he was            wiesz=you know
bardzo=very          było=it was             przez=through, by     jego=his, him
chcę=I want          dlaczego=why            pani=madam, Mrs       jeszcze=still, yet
mój=my, mine         nas=us                  żeby=so that          chcesz=you want
ich=their, them      też=also, too           tutaj=here            naprawdę=really
nigdy=never          mamy=we have            kto=who               możesz=you can
dobra=alright, OK    przepraszam=sorry       gdy=when              muszę=I must
porządku=order       dziękuję=thank you      nawet=even            chyba=probably
domu=house (gen.)    ona=she                 prawda=truth          zrobić=to do, to make
była=she was         właśnie=exactly, just   będę=I will be        zawsze=always
hej=hey              nim=him (inst.)         nam=to us             moja=my (fem.)
musisz=you must      dzięki=thanks           bez=without           tej=this (fem. gen.)
trochę=a little      ktoś=someone            panie=sir (voc.)      jesteśmy=we are
moje=my (pl.)        powiedzieć=to say       który=which, who      czas=time
więcej=more          twój=your, yours        musimy=we must        lat=years (gen.)
chce=he/she wants    możemy=we can           wszyscy=everyone      tobą=you (inst.)
albo=or              prostu=simply (po ~)    chodzi=it's about     razem=together
stało=it happened    cześć=hi; honour        mną=me (inst.)        czego=what (gen.), why
sam=alone, myself    myślę=I think           pana=sir (gen.)       przed=before, in front of
boże=God! (voc.)     raz=once, one time      czemu=why             będziesz=you will be
niż=than             ludzie=people           dalej=further; go on  czym=what (inst.)
was=you (pl.)        dobry=good              przy=at, near, by     ludzi=people (gen.)
dzień=day            życie=life              lepiej=better         miał=he had
rzeczy=things        temu=ago                robisz=you do         myślisz=you think
kim=who (inst.)      niech=let               które=which (pl.)     oczywiście=of course
siebie=oneself       niego=him (gen.)        cóż=well, what        powiedział=he said
daj=give             moim=my (inst./loc.)    chodź=come            musi=he/she must
nikt=nobody          twoje=your (pl.)        tych=these (gen.)     pod=under
dlatego=therefore    pewnie=surely           powiedz=say, tell     aby=in order to
wtedy=then           wygląda=looks, seems    jeden=one             mojego=my (gen.)
mówi=says, speaks    dziś=today              taki=such, so         mieć=to have
jako=as              dwa=two                 potem=afterwards      wie=knows
takie=such (pl.)     nią=her (inst.)         wszystkie=all         znaczy=means
rozumiem=I see       dzieje=happens          moją=my (fem. acc.)   będziemy=we will be
wiele=many, much     stąd=from here          oni=they              mojej=my (fem. gen.)
miejsce=place        iść=to go, to walk      kilka=a few           pomóc=to help
dużo=a lot, much     ile=how much            jasne=clear, sure     byłem=I was
swoje=one's own      myśli=thoughts; thinks  cały=whole, entire    skąd=from where
przestań=stop it     żebyś=so that you       może=maybe; can       kocham=I love

zostać=to stay; become   znaleźć=to find       wrócić=to come back   wziąć=to take
dostać=to get, receive   zacząć=to begin       przyjść=to come       pozwolić=to allow
przestać=to stop         zabrać=to take away   zostawić=to leave     skończyć=to finish
zadzwonić=to phone       spotkać=to meet       zmienić=to change     dawać=to give
sprawdzić=to check       posłuchać=to listen   zająć=to occupy       pokazać=to show
spróbować=to try         stracić=to lose       zrozumieć=to understand
wybaczyć=to forgive      zatrzymać=to stop     uwierzyć=to believe   wysłać=to send
zapomnieć=to forget      dowiedzieć=to find out (się)
zrobił=he did, he made   został=he stayed      posłuchaj=listen!     zrobię=I will do
nami=us (inst.)          gdyby=if, were it that
`;

function parseOverrides(text: string): Map<string, string> {
  const out = new Map<string, string>();
  // Columns are for the human reading this file; two or more spaces end a cell.
  for (const cell of text.split('\n').flatMap((l) => l.trim().split(/ {2,}/))) {
    const i = cell.indexOf('=');
    if (i > 0) out.set(cell.slice(0, i).trim(), cell.slice(i + 1).trim());
  }
  return out;
}

/**
 * WikDict sometimes leaves the *Polish* definition where the English gloss
 * belongs. Diacritics catch most of those; this catches the ones written
 * entirely in letters English also uses.
 */
const POLISH_TELL = new Set(['osoba','osobie','liczby','liczbie','pojedynczej','mnogiej','jedna','nazw','nazwa','litery','alfabetu','czasie','wzmocnienia','przymiotnika','rzeczownika','czasownika','forma','oraz','ktory','ktora','ktore','cos','ktos','jest','sie','przez','wedlug','albo']);

/** The English half of a dictd entry: its numbered senses, at most two. */
function polishGloss(body: string): string {
  const out: string[] = [];
  for (const line of body.split('\n').slice(1).map((l) => l.trim()).filter(Boolean)) {
    const m = /^\d+\.\s*(.+)$/.exec(line);
    // WikDict leaves the *next* sense's number stuck on the end of the line it
    // finished: `arbuz` reads "watermelon, water melon 2.", and the first sense
    // is usually unnumbered, so this has to come off both branches or half the
    // dictionary is glossed with a dangling ordinal.
    const g = (m ? m[1]! : out.length === 0 ? line : '').replace(/\s*\d+\.\s*$/, '').trim();
    // `dobry` yields "B", the school-grade sense, scraped out of a table. A
    // gloss of one or two characters is never a translation.
    if (!g || g.length < 3 || !/[a-z]{2}/.test(g) || /[ąćęłńóśźż]/i.test(g)) continue;
    if (g.toLowerCase().split(/[^a-z]+/).some((t) => POLISH_TELL.has(t))) continue;
    out.push(g);
    if (out.length >= 2) break;
  }
  return out.join('; ');
}

/** dictd stores offsets base64-encoded against its own alphabet. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const b64 = (s: string) => [...s].reduce((n, c) => n * 64 + B64.indexOf(c), 0);

function readDictd(dir: string): Map<string, string> {
  const dict = readFileSync(join(dir, 'pol-eng.dict'));
  const out = new Map<string, string>();
  for (const line of readFileSync(join(dir, 'pol-eng.index'), 'utf8').split('\n')) {
    const [head, off, len] = line.split('\t');
    if (!head || !off || !len || head.startsWith('00database')) continue;
    out.set(head, dict.subarray(b64(off), b64(off) + b64(len)).toString('utf8'));
  }
  return out;
}

/**
 * Form -> lemmas, for the forms we care about only. PoliMorf is 4.8M lines of
 * `lemma;form;tags` and 333MB, so it is streamed and filtered rather than
 * loaded: everything outside the frequency list is thrown away as it goes by.
 */
async function lemmaBridge(path: string, wanted: Set<string>): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    const a = line.indexOf(';');
    if (a < 0) continue;
    const b = line.indexOf(';', a + 1);
    const form = (b < 0 ? line.slice(a + 1) : line.slice(a + 1, b)).toLowerCase();
    if (!wanted.has(form)) continue;
    const lemma = line.slice(0, a).toLowerCase();
    const got = out.get(form);
    if (!got) out.set(form, [lemma]);
    else if (!got.includes(lemma)) got.push(lemma);
  }
  return out;
}

/** Shape alone: lower-case Polish letters, long enough to play. */
const PL_SHAPE = /^[a-ząćęłńóśźż]+$/;
const plausible = (w: string) => PL_SHAPE.test(w) && w.length >= MIN_LENGTH;

/**
 * How common a Polish *word* is, as against how common one of its forms is.
 *
 * The frequency list counts strings, and Polish spreads a word over strings:
 * `awantura` is a row people have in films constantly, and it arrives here as
 * `awantury` 369, `awanturę` 337 and `awantura` 302: three entries in the
 * thirty-five-to-forty-thousands, none of which looks like a word worth
 * keeping, and a 30,000-word cut takes all three. Summed through the lemma
 * bridge it is one word with 1,008 occurrences, which puts it where a player
 * would expect to find it.
 *
 * The sum lands on the lemma *and* the form, because both are playable and the
 * player decides which they type.
 *
 * A form only speaks for its lemma when it has exactly one, and that rule is
 * doing more work than it looks like. Splitting an ambiguous form's count
 * between its lemmas was tried first and is not nearly strict enough, because
 * the disparities are thousandfold. PoliMorf lists `w`, the preposition "in"
 * at 3,988,120 occurrences and the commonest string in the language, as an
 * abbreviation of both `wat` and `wiek`, so even half of it put "watt" and
 * "century" in the fifteen commonest Polish words. `mnie` did the same for
 * `miąć` (to crumple), and `tak` for `taka`.
 *
 * The words this protects are not the words it costs. An oblique case of a
 * noun is usually unambiguous (`arbuza`, `awantury`) so the nouns that needed
 * rescuing keep their credit; what loses it is the function words,
 * which are all in `PL_OVERRIDE` at the top of the list already.
 */
function weighPolish(count: Map<string, number>, lemmas: Map<string, string[]>): Map<string, number> {
  const weight = new Map<string, number>();
  const add = (w: string, n: number) => weight.set(w, (weight.get(w) ?? 0) + n);
  for (const [form, n] of count) {
    const known = lemmas.get(form);
    if (!known) continue;
    add(form, n);
    // The lemma is credited even when no subtitle ever used it: `arbuz` is not
    // anywhere in fifty thousand words of film dialogue, `arbuza` is, and the
    // nominative is the form a player types.
    if (known.length === 1 && known[0] !== form) add(known[0]!, n);
  }
  return weight;
}

interface PlWord { w: string; lemma: string; gloss: string }

function buildPolish(
  weight: Map<string, number>,
  lemmas: Map<string, string[]>,
  dict: Map<string, string>,
  english: ReadonlySet<string>,
): PlWord[] {
  const override = parseOverrides(PL_OVERRIDE);
  const out: PlWord[] = [];
  // Three sources of candidate, one order.
  //
  // The weights are the frequency list, rolled up; the overrides are there
  // because a word PoliMorf has never heard of gets no weight and the hundred
  // words the game shows most often are not losing their hand-checked glosses
  // to that. The third is the answer to "why can this game not play `żyrafa`":
  // films talk about love and death and money, so a frequency list is a fair
  // account of what a Polish speaker *says* and a poor one of what they know.
  // A dictionary headword that PoliMorf confirms is a lemma of its own is a
  // Polish word whether or not anyone filmed it.
  //
  // Sorting the three together by weight is what makes mixing them safe. A
  // word no subtitle ever used weighs zero and lands at the very end, below
  // everything anybody actually says, and the reveal and the "commonest word
  // starting with A" scan both read from the top, so a word that got in on a
  // dictionary's say-so is never *offered*, only accepted when someone types
  // it. The alphabetical tiebreak is for the humans reading the file, and it
  // happens to compress well, which at twenty thousand zero-weight words is
  // not nothing.
  const citation = [...dict.keys()].filter((w) => lemmas.get(w)?.includes(w));
  const ordered = [...new Set([...weight.keys(), ...override.keys(), ...citation])]
    .filter(plausible)
    .sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0) || a.localeCompare(b, 'pl'));
  for (const w of ordered) {
    // A form PoliMorf has never heard of is OpenSubtitles noise: a typo, a
    // transcription, half a name, not a Polish word whatever its rank.
    const known = lemmas.get(w);
    if (!known && !override.has(w)) continue;
    // `mam` lemmatises to both `mama` and `mieć`. The one a learner means is
    // the one that is itself common, so the candidates are tried in their own
    // frequency order, which is what stops "I have" being glossed "mother".
    const cands = [w, ...(known ?? [])]
      .filter((c, i, a) => a.indexOf(c) === i)
      .sort((a, b) => (a === w ? -1 : b === w ? 1 : (weight.get(b) ?? 0) - (weight.get(a) ?? 0)));
    let lemma = '';
    let gloss = override.get(w) ?? '';
    for (const c of cands) {
      if (c !== w && !lemma && known?.includes(c)) lemma = c;
      if (gloss) break;
      const body = dict.get(c);
      const g = body ? polishGloss(body) : '';
      if (g) { gloss = g; lemma = c === w ? '' : c; break; }
    }
    if (lemma === w) lemma = '';
    // Polish subtitles quote English, and PoliMorf takes in borrowings, so
    // `young` and `sorry` arrive here looking Polish. A word that is common
    // English *and* that no Polish dictionary can gloss is not a Polish word.
    // It was the commonest thing the game could think of starting with Y,
    // which made the reveal teach the wrong language.
    if (!gloss && english.has(w)) continue;
    // Depth counts the list as emitted, not the candidates walked to build it:
    // a fifth of them are dropped on the way past and a rank that counted those
    // would cut the glosses short of where the constant says.
    out.push({ w, lemma, gloss: out.length < PL_GLOSS_DEPTH ? gloss : '' });
    if (out.length >= LIMIT.pl) break;
  }
  return out;
}

/* ------------------------------------------------------------------- English */

/**
 * Common *and* a real word. OpenSubtitles alone lets in transcription noise
 * and misspellings; `words.ts` alone lets in `aal` and `abb`, because
 * dwyl/english-words is deliberately the most permissive list going. Each is
 * the other's filter.
 *
 * Which is also why English needs no dictionary tail the way Polish does. The
 * full frequency list is 1.66M strings, so `LIMIT.en` cuts it long before it
 * runs out, and every word in it kept its frequency order: there is no
 * zero-weight block at the bottom, and the reveal can read from the top of a
 * fifty-thousand-word list with the same confidence it read from a
 * twenty-five-thousand-word one.
 */
function buildEnglish(freq: Map<string, number>, valid: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const w of freq.keys()) {
    // The set is upper-cased; `isWord` upper-cases before asking it too.
    if (w.length >= MIN_LENGTH && /^[a-z]+$/.test(w) && valid.has(w.toUpperCase())) out.push(w);
  }
  return out;
}

/* ---------------------------------------------------------------------- emit */

/** Wrap a space-separated run, the way `words.ts` is wrapped: for human eyes. */
function wrap(words: string[], width = 76): string {
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line.length + w.length + 1 > width) { lines.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

function emit(pl: PlWord[], ja: JaWord[], en: string[]): string {
  const plLines = pl.map((r) => (r.gloss ? `${r.w}|${r.lemma}|${r.gloss}` : r.w));
  const jaLines = ja.map((r) => `${r.romaji}|${r.kana}|${r.kanji}|${r.gloss}`);
  return `/**
 * Word Chain's three word lists. GENERATED, so do not edit by hand.
 *
 *   npm run build:wordchain
 *
 * \`scripts/build-wordchain.ts\` is where the sources, the licences and every
 * judgement call that shaped this file are written down. Read that before
 * changing anything here, because the answer is almost always to change the
 * script and run it again.
 *
 * Each list is ordered by frequency, commonest first, and that order is load
 * bearing: when a player's minute runs out the game reveals the commonest word
 * they could have played, and it finds it by reading from the top.
 *
 * Sources: hermitdave/FrequencyWords (CC-BY-SA 4.0), PoliMorf 2.1 (BSD),
 * FreeDict pol-eng (CC-BY-SA 3.0, from Wiktionary via WikDict), EDICT2
 * (CC-BY-SA 4.0, Electronic Dictionary Research and Development Group).
 *
 * Only the server ever reads this. A board renders the word and the gloss the
 * server sent it and never checks anything itself. \`bundle.test.ts\` holds
 * that line, for the same reason it holds it for \`words.ts\`.
 */

/** \`word\` or \`word|lemma|gloss\`, one per line, commonest first. */
export const PL_SOURCE = \`
${plLines.join('\n')}
\`;

/** \`romaji|kana|kanji|gloss\`, one per line, commonest first. \`kanji\` may be empty. */
export const JA_SOURCE = \`
${jaLines.join('\n')}
\`;

/** Space separated, commonest first. English needs no gloss; it is the gloss. */
export const EN_SOURCE = \`
${wrap(en)}
\`;
`;
}

async function main() {
  const plCount = counts(readFileSync(await ensure('pl_50k.txt'), 'utf8'));
  const enFreq = frequency(readFileSync(await ensure('en_full.txt'), 'utf8'));
  const jaFreq = frequency(readFileSync(await ensure('ja_50k.txt'), 'utf8'));

  const ja = buildJapanese(readFileSync(await ensure('edict2u.txt'), 'utf8'), jaFreq).slice(0, LIMIT.ja);

  await ensure('pol-eng/pol-eng.index');
  const dict = readDictd(join(CACHE, 'pol-eng'));
  // Both halves of the Polish list want the bridge: the frequency half asks it
  // what a form's lemma is, and the dictionary tail asks it whether a headword
  // is a word at all. One 333MB pass answers both.
  const wanted = new Set([...plCount.keys(), ...[...dict.keys()].map((h) => h.toLowerCase())]);
  const lemmas = await lemmaBridge(await ensure('polimorfologik-2.1.txt'), wanted);
  const weight = weighPolish(plCount, lemmas);

  const { allWords } = await import('../src/shared/games/words.js');
  const en = buildEnglish(enFreq, allWords()).slice(0, LIMIT.en);
  const pl = buildPolish(weight, lemmas, dict, new Set(en.slice(0, EN_COMMON)));

  const glossed = pl.filter((r) => r.gloss).length;
  process.stderr.write(
    `polish   ${pl.length} words, ${glossed} glossed (${((100 * glossed) / pl.length).toFixed(1)}%)\n` +
    `japanese ${ja.length} words, all glossed\n` +
    `english  ${en.length} words\n`,
  );
  // CRLF: the working tree is autocrlf, and a file written LF shows up as a
  // whole-file diff every time the script runs.
  writeFileSync(OUT, emit(pl, ja, en).replace(/\r?\n/g, '\r\n'));
  process.stderr.write(`wrote ${OUT}\n`);
}

void main();
