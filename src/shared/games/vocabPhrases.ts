/**
 * The third thing Vocab Race can ask about: the sentences a day is actually
 * made of.
 *
 * Every other clue in this game is a slice of Word Chain's frequency lists,
 * which is why the game cost the bundle nothing (see `vocabDictionary.ts`).
 * This one is hand-written, and it is the only new corpus in the repo, because
 * the thing it teaches is not in a frequency list at all. The top hundred
 * Polish words are `nie w na to`, and knowing all hundred of them does not get
 * you a coffee: *zrobisz mi kawę?* is four words, three of which are nowhere
 * near the top hundred, and it is the first Polish anybody actually needs.
 * Frequency lists teach the mortar and this teaches a wall.
 *
 * One English list with both translations on it, rather than a list per
 * language. That is not tidiness: `MODE_CAP.phrases` is a rank cap over a deck
 * dealt before the language is known (point 6 in `vocab.ts`), so the two
 * languages have to be the same length or a room would find its deck shorter
 * for having picked Japanese. Parallel entries make that true by construction
 * instead of by a constant somebody has to remember to keep in step.
 *
 * Server-only, the same two reasons as `vocabDictionary.ts`: it reaches the
 * word lists through `chainDictionary.js`, and the answer to the clue on the
 * screen is a secret.
 *
 * ## Adding a phrase
 *
 * It goes on the end, and `PHRASE_COUNT` in `vocabDisplay.ts` goes up by one.
 * On the end because a rank is a position here, so inserting in the middle
 * renumbers every phrase after it, and a stored `VocabState` holds a dealt
 * deck of ranks: an old snapshot would resume asking for phrase 12 and be
 * handed a different sentence. That is a `SNAPSHOT_VERSION` bump, and adding
 * to the end is not.
 *
 * Two rules about what to add. It has to be something a person says out loud
 * in a kitchen, a shop or a doorway, and it has to be *one* way of saying it:
 * a clue with three idiomatic translations is a clue whose right answer is
 * whichever one the writer happened to think of first. Where a phrase genuinely
 * has common variants -- a gendered Polish adjective, a casual Japanese form,
 * the same sentence with and without its politeness -- they go in `also`,
 * which is what a guess is marked against, and the canonical one stays in `pl`
 * or `ja` and is what the reveal teaches.
 */
import { fold, jaLoose } from './chainDictionary.js';
import type { VocabQuestion } from './vocabDictionary.js';
import type { VocabLang } from './vocabDisplay.js';

/**
 * One thing worth being able to say, in three languages.
 *
 * `en` is the clue, and it is the whole question on a `say` round, so it is
 * written as somebody would say it in English rather than as a gloss:
 * "Can you turn off the light?" and not "turn off light (request)". It is also
 * one of the four options on a `pick` round, which is the other reason it has
 * to read as a sentence.
 */
interface Phrase {
  en: string;
  /** Polish, spelled properly. The accents are taught, never demanded. */
  pl: string;
  /** Japanese in romaji, which is what the box takes. */
  ja: string;
  /** The same, in kana and kanji: what a learner has to end up reading. */
  script: string;
  /**
   * Everything else that is the same sentence, per language. Marked right,
   * never shown.
   *
   * Polish carries the other gender of any adjective in here, and that is not
   * a nicety: *jestem głodny* and *jestem głodna* are the same sentence said
   * by different people, and a game that marks half its players wrong for
   * describing themselves correctly is not teaching Polish. Japanese carries
   * the casual form beside the polite one for the same reason -- *nemui* and
   * *nemui desu* are both what somebody says -- plus the spellings romaji
   * cannot agree on, though most of those `jaLoose` already forgives.
   */
  also?: { pl?: string[]; ja?: string[] };
}

/**
 * The phrases, in the order they were written, which is also their rank.
 *
 * Roughly ordered by how early you would want it: greetings and courtesies
 * first, then the sentences about your own body, then the ones you say to
 * somebody else, then the shop. Only roughly, and nothing depends on it -- the
 * deck is shuffled -- but the order is what `rank` shows on the reveal, and a
 * list where #3 is "thank you" reads as a curriculum rather than as a heap.
 *
 * It does mean rarity pays the same for all of them; see `PHRASE_RARITY`.
 */
const PHRASES: readonly Phrase[] = [
  {
    en: 'Hello',
    pl: 'cześć',
    ja: 'konnichiwa',
    script: 'こんにちは',
    also: { pl: ['dzień dobry', 'hej', 'siema', 'witaj', 'witam'], ja: ['konnichiha'] },
  },
  {
    en: 'Good morning',
    pl: 'dzień dobry',
    ja: 'ohayou gozaimasu',
    script: 'おはようございます',
    also: { pl: ['dobry'], ja: ['ohayou', 'ohayo', 'ohayo gozaimasu'] },
  },
  {
    en: 'Good night',
    pl: 'dobranoc',
    ja: 'oyasumi nasai',
    script: 'おやすみなさい',
    also: { pl: ['dobrej nocy'], ja: ['oyasumi', 'oyasuminasai'] },
  },
  {
    en: 'Goodbye',
    pl: 'do widzenia',
    ja: 'sayounara',
    script: 'さようなら',
    also: { pl: ['do zobaczenia', 'na razie', 'żegnaj', 'pa', 'papa', 'cześć'], ja: ['sayonara'] },
  },
  {
    en: 'Thank you',
    pl: 'dziękuję',
    ja: 'arigatou',
    script: 'ありがとう',
    also: { pl: ['dzięki', 'dziękuję bardzo', 'dziękuję ci', 'dzięki wielkie', 'dziękujemy'], ja: ['arigato', 'arigatou gozaimasu', 'doumo'] },
  },
  {
    en: 'Please',
    pl: 'proszę',
    ja: 'onegaishimasu',
    script: 'お願いします',
    also: { pl: ['proszę bardzo', 'poproszę'], ja: ['onegai shimasu', 'onegai'] },
  },
  {
    en: "I'm sorry",
    pl: 'przepraszam',
    ja: 'gomen nasai',
    script: 'ごめんなさい',
    also: { pl: ['przykro mi', 'przepraszam cię', 'wybacz', 'bardzo przepraszam'], ja: ['gomennasai', 'gomen', 'sumimasen'] },
  },
  {
    en: 'Nice to meet you',
    pl: 'miło mi cię poznać',
    ja: 'hajimemashite',
    script: 'はじめまして',
    also: { pl: ['miło mi', 'miło cię poznać', 'miło mi pana poznać', 'miło mi panią poznać', 'bardzo mi miło'] },
  },
  {
    en: 'How are you?',
    pl: 'jak się masz?',
    ja: 'genki desu ka',
    script: '元気ですか',
    also: { pl: ['co słychać?', 'jak leci?', 'co u ciebie?', 'jak się czujesz?', 'jak się pan ma?', 'jak się pani ma?'], ja: ['ogenki desu ka', 'genki'] },
  },
  {
    en: "I'm fine",
    pl: 'mam się dobrze',
    ja: 'genki desu',
    script: '元気です',
    also: { pl: ['wszystko dobrze', 'dobrze', 'w porządku', 'mam się świetnie', 'dobrze się mam'], ja: ['genki da', 'daijoubu desu'] },
  },
  {
    en: 'See you tomorrow',
    pl: 'do jutra',
    ja: 'mata ashita',
    script: 'また明日',
    also: { pl: ['do zobaczenia jutro'], ja: ['mata ashita ne'] },
  },
  {
    en: 'Yes, please',
    pl: 'tak, poproszę',
    ja: 'hai, onegaishimasu',
    script: 'はい、お願いします',
    also: { pl: ['poproszę', 'tak, proszę', 'tak poproszę'], ja: ['hai onegai shimasu'] },
  },
  {
    en: 'No, thank you',
    pl: 'nie, dziękuję',
    ja: 'iie, kekkou desu',
    script: 'いいえ、結構です',
    also: { pl: ['nie, dzięki', 'dziękuję, nie'], ja: ['kekkou desu', 'iie kekko desu', 'daijoubu desu'] },
  },
  {
    en: "I'm hungry",
    pl: 'jestem głodny',
    ja: 'onaka ga suita',
    script: 'お腹が空いた',
    also: { pl: ['jestem głodna', 'głodny jestem', 'głodna jestem', 'chce mi się jeść'], ja: ['onaka suita', 'onaka ga sukimashita'] },
  },
  {
    en: 'Are you hungry?',
    pl: 'jesteś głodny?',
    ja: 'onaka suita?',
    script: 'お腹すいた？',
    also: { pl: ['jesteś głodna?', 'głodny?', 'głodna?', 'czy jesteś głodny?'], ja: ['onaka ga suita ka', 'onaka sukimashita ka'] },
  },
  {
    en: "I'm thirsty",
    pl: 'chce mi się pić',
    ja: 'nodo ga kawaita',
    script: '喉が渇いた',
    also: { pl: ['jestem spragniony', 'jestem spragniona', 'pić mi się chce'], ja: ['nodo kawaita'] },
  },
  {
    en: "I'm sleepy",
    pl: 'jestem śpiący',
    ja: 'nemui',
    script: '眠い',
    also: { pl: ['jestem śpiąca', 'chce mi się spać', 'śpiący jestem', 'śpiąca jestem', 'spać mi się chce'], ja: ['nemui desu'] },
  },
  {
    en: 'Are you sleepy?',
    pl: 'jesteś śpiący?',
    ja: 'nemui desu ka',
    script: '眠いですか',
    also: { pl: ['jesteś śpiąca?', 'śpiący?', 'śpiąca?', 'chce ci się spać?'], ja: ['nemui?', 'nemui no'] },
  },
  {
    en: "I'm tired",
    pl: 'jestem zmęczony',
    ja: 'tsukareta',
    script: '疲れた',
    also: { pl: ['jestem zmęczona', 'zmęczony jestem', 'zmęczona jestem'], ja: ['tsukaremashita', 'tsukareta yo'] },
  },
  {
    en: "I'm cold",
    pl: 'jest mi zimno',
    ja: 'samui',
    script: '寒い',
    also: { pl: ['zimno mi', 'jest zimno', 'marznę'], ja: ['samui desu'] },
  },
  {
    en: "I'm hot",
    pl: 'jest mi gorąco',
    ja: 'atsui',
    script: '暑い',
    also: { pl: ['gorąco mi', 'jest gorąco'], ja: ['atsui desu'] },
  },
  {
    en: 'Can you make me a coffee?',
    pl: 'zrobisz mi kawę?',
    ja: 'koohii o tsukutte kuremasu ka',
    script: 'コーヒーを作ってくれますか',
    also: {
      pl: ['możesz zrobić mi kawę?', 'zrób mi kawę', 'możesz mi zrobić kawę?', 'zrobisz mi kawy?'],
      ja: ['koohii o tsukutte kureru', 'koohii onegaishimasu'],
    },
  },
  {
    en: 'Can you make me a tea?',
    pl: 'zrobisz mi herbatę?',
    ja: 'ocha o irete kuremasu ka',
    script: 'お茶を入れてくれますか',
    also: {
      pl: ['możesz zrobić mi herbatę?', 'zrób mi herbatę', 'możesz mi zrobić herbatę?', 'zrobisz mi herbaty?'],
      ja: ['ocha o irete kureru', 'ocha onegaishimasu'],
    },
  },
  {
    en: 'May I have the donut?',
    pl: 'mogę prosić pączka?',
    ja: 'doonatsu o moratte mo ii desu ka',
    script: 'ドーナツをもらってもいいですか',
    also: {
      pl: ['poproszę pączka', 'czy mogę prosić pączka?', 'mogę prosić o pączka?', 'poproszę o pączka', 'czy mogę dostać pączka?'],
      ja: ['doonatsu o kudasai', 'doonatsu moratte mo ii'],
    },
  },
  {
    en: 'Enjoy your meal',
    pl: 'smacznego',
    ja: 'itadakimasu',
    script: 'いただきます',
    also: { pl: ['życzę smacznego'], ja: ['meshiagare'] },
  },
  {
    en: "It's delicious",
    pl: 'jest pyszne',
    ja: 'oishii',
    script: 'おいしい',
    also: { pl: ['pyszne', 'bardzo dobre', 'jest pyszny', 'jest pyszna', 'smaczne', 'jest smaczne'], ja: ['oishii desu', 'umai'] },
  },
  {
    en: 'Card, please',
    pl: 'kartą poproszę',
    ja: 'kaado de onegaishimasu',
    script: 'カードでお願いします',
    also: { pl: ['poproszę kartą', 'płacę kartą', 'zapłacę kartą', 'czy mogę zapłacić kartą?'], ja: ['kaado de', 'kaado onegaishimasu'] },
  },
  {
    en: 'The bill, please',
    pl: 'poproszę rachunek',
    ja: 'okaikei onegaishimasu',
    script: 'お会計お願いします',
    also: { pl: ['rachunek poproszę', 'proszę o rachunek', 'poproszę o rachunek', 'płacę'], ja: ['kaikei onegaishimasu', 'okanjou onegaishimasu'] },
  },
  {
    en: 'How much is it?',
    pl: 'ile to kosztuje?',
    ja: 'ikura desu ka',
    script: 'いくらですか',
    also: { pl: ['ile kosztuje?', 'ile to?', 'ile płacę?', 'ile za to?'], ja: ['ikura', 'ikura desu'] },
  },
  {
    en: 'What time is it?',
    pl: 'która godzina?',
    ja: 'nanji desu ka',
    script: '何時ですか',
    also: { pl: ['jaka jest godzina?', 'która jest godzina?', 'godzina?'], ja: ['ima nanji desu ka', 'nanji'] },
  },
  {
    en: 'Where is the toilet?',
    pl: 'gdzie jest toaleta?',
    ja: 'toire wa doko desu ka',
    script: 'トイレはどこですか',
    also: { pl: ['gdzie jest łazienka?', 'gdzie jest ubikacja?', 'gdzie są toalety?', 'gdzie znajduje się toaleta?'], ja: ['otearai wa doko desu ka', 'toire wa doko'] },
  },
  {
    en: 'Where are you?',
    pl: 'gdzie jesteś?',
    ja: 'doko ni imasu ka',
    script: 'どこにいますか',
    also: { pl: ['gdzie jesteście?', 'gdzie pan jest?', 'gdzie pani jest?'], ja: ['doko ni iru', 'ima doko'] },
  },
  {
    en: "I'm at home",
    pl: 'jestem w domu',
    ja: 'ie ni imasu',
    script: '家にいます',
    also: { pl: ['jestem u siebie', 'w domu'], ja: ['uchi ni imasu', 'ie ni iru'] },
  },
  {
    en: 'Can you turn off the light?',
    pl: 'zgasisz światło?',
    ja: 'denki o keshite kuremasu ka',
    script: '電気を消してくれますか',
    also: {
      pl: ['możesz zgasić światło?', 'zgaś światło', 'wyłącz światło', 'możesz wyłączyć światło?'],
      ja: ['denki o keshite', 'denki keshite kureru'],
    },
  },
  {
    en: 'Can you turn on the light?',
    pl: 'zapalisz światło?',
    ja: 'denki o tsukete kuremasu ka',
    script: '電気をつけてくれますか',
    also: {
      pl: ['możesz zapalić światło?', 'zapal światło', 'włącz światło', 'możesz włączyć światło?'],
      ja: ['denki o tsukete', 'denki tsukete kureru'],
    },
  },
  {
    en: 'Can you help me?',
    pl: 'możesz mi pomóc?',
    ja: 'tetsudatte kuremasu ka',
    script: '手伝ってくれますか',
    also: { pl: ['pomożesz mi?', 'pomóż mi', 'czy możesz mi pomóc?'], ja: ['tetsudatte kureru', 'tasukete kuremasu ka'] },
  },
  {
    en: 'Wait a moment',
    pl: 'chwileczkę',
    ja: 'chotto matte',
    script: 'ちょっと待って',
    also: { pl: ['poczekaj chwilę', 'zaczekaj', 'chwilę', 'moment', 'chwileczka', 'sekundę'], ja: ['chotto matte kudasai', 'matte'] },
  },
  {
    en: "Let's go",
    pl: 'chodźmy',
    ja: 'ikimashou',
    script: '行きましょう',
    also: { pl: ['idziemy', 'chodź', 'ruszamy', 'idźmy'], ja: ['ikou', 'ikimasho'] },
  },
  {
    en: "I don't understand",
    pl: 'nie rozumiem',
    ja: 'wakarimasen',
    script: 'わかりません',
    also: { pl: ['nie rozumiem cię', 'nie zrozumiałem', 'nie zrozumiałam'], ja: ['wakaranai', 'wakannai'] },
  },
  {
    en: "I don't know",
    pl: 'nie wiem',
    ja: 'shirimasen',
    script: '知りません',
    also: { pl: ['nie mam pojęcia'], ja: ['shiranai', 'wakarimasen'] },
  },
  {
    en: 'Say that again, please',
    pl: 'proszę powtórzyć',
    ja: 'mou ichido onegaishimasu',
    script: 'もう一度お願いします',
    also: { pl: ['możesz powtórzyć?', 'powtórz proszę', 'jeszcze raz proszę', 'proszę powtórz'], ja: ['mou ichido itte kudasai', 'mo ichido onegaishimasu'] },
  },
  {
    en: 'Please speak more slowly',
    pl: 'proszę mówić wolniej',
    ja: 'motto yukkuri onegaishimasu',
    script: 'もっとゆっくりお願いします',
    also: { pl: ['mów wolniej', 'wolniej proszę', 'możesz mówić wolniej?', 'proszę mówić wolno'], ja: ['yukkuri onegaishimasu', 'motto yukkuri hanashite kudasai'] },
  },
  {
    en: 'Do you speak English?',
    pl: 'czy mówisz po angielsku?',
    ja: 'eigo o hanasemasu ka',
    script: '英語を話せますか',
    also: { pl: ['mówisz po angielsku?', 'czy mówi pan po angielsku?', 'czy mówi pani po angielsku?', 'mówi pan po angielsku?'], ja: ['eigo ga hanasemasu ka', 'eigo dekimasu ka'] },
  },
  {
    en: 'Happy birthday',
    pl: 'wszystkiego najlepszego',
    ja: 'otanjoubi omedetou',
    script: 'お誕生日おめでとう',
    also: {
      pl: ['sto lat', 'wszystkiego najlepszego z okazji urodzin', 'najlepszego'],
      ja: ['tanjoubi omedetou', 'otanjoubi omedetou gozaimasu'],
    },
  },
  {
    en: 'I love you',
    pl: 'kocham cię',
    ja: 'aishiteru',
    script: '愛してる',
    also: { pl: ['ja cię kocham'], ja: ['aishiteimasu', 'daisuki'] },
  },
];

/** How many there are. `PHRASE_COUNT` in the display module has to match. */
export const phraseCount = (): number => PHRASES.length;

/**
 * What a phrase, or a typed attempt at one, is reduced to before they meet.
 *
 * Three keys rather than one, because a phrase can be typed in three
 * alphabets' worth of ways and all of them are the same sentence:
 *
 * - `fold` is the word lists' own reduction, lower case with the Polish
 *   accents off and everything that is not a letter dropped. That last part is
 *   what makes punctuation free: *gdzie jesteś?* and *gdzie jestes* land on the
 *   same key, and nobody is marked wrong for not typing a question mark;
 * - `jaLoose` is the romaji forgiveness Word Chain already needed, so
 *   *koohii* and *kohii* and *koffee*'s near misses collapse together. Only
 *   for Japanese, where it means something;
 * - `wide` keeps every letter Unicode knows about, which is the only one of
 *   the three that survives kana and kanji. A learner who has got as far as
 *   typing 眠い should not be told it is not Japanese.
 *
 * A key is only kept when it is non-empty: `fold` of a kana phrase is the
 * empty string, and an empty key in the accepts set would match every empty
 * key that came near it.
 */
export function phraseKeys(text: string, lang: VocabLang): string[] {
  const out: string[] = [];
  const flat = fold(text);
  if (flat.length > 0) out.push(flat);
  if (lang === 'ja') {
    const loose = jaLoose(text);
    if (loose.length > 0) out.push(`loose:${loose}`);
  }
  const wide = text.normalize('NFKC').toLowerCase().replace(/\P{L}/gu, '');
  if (wide.length > 0) out.push(`wide:${wide}`);
  return out;
}

/** Every key that should be marked right for one phrase. */
function acceptsOf(phrase: Phrase, lang: VocabLang): Set<string> {
  const said = [
    lang === 'pl' ? phrase.pl : phrase.ja,
    ...(lang === 'pl' ? (phrase.also?.pl ?? []) : (phrase.also?.ja ?? [])),
    // The script goes in for Japanese only, and it is the reason `wide`
    // exists: it is the form the reveal has been teaching all game, so a
    // player who types it back has plainly answered the question.
    ...(lang === 'ja' ? [phrase.script] : []),
  ];
  const out = new Set<string>();
  for (const text of said) for (const key of phraseKeys(text, lang)) out.add(key);
  return out;
}

const decks: Partial<Record<VocabLang, Map<number, VocabQuestion>>> = {};

/**
 * Built lazily and per language, the same as every other list in this repo:
 * most rooms are playing Connect Four.
 */
function build(lang: VocabLang): Map<number, VocabQuestion> {
  const byRank = new Map<number, VocabQuestion>();
  PHRASES.forEach((phrase, i) => {
    byRank.set(i + 1, {
      clue: phrase.en,
      word: lang === 'pl' ? phrase.pl : phrase.ja,
      // Polish is already written in its own alphabet, so a second line under
      // it would be the same string twice. Same rule as the word decks.
      script: lang === 'ja' ? phrase.script : '',
      // A phrase has no dictionary form. Empty rather than the phrase itself,
      // because the board draws this line only when it differs from the word,
      // and "from: zrobisz mi kawę" under *zrobisz mi kawę* teaches nothing.
      lemma: '',
      rank: i + 1,
      accepts: acceptsOf(phrase, lang),
      // No alternatives line on a phrase. `acceptsOf` holds the other ways of
      // saying this one, both Polish genders and the casual Japanese, so there
      // is something here in principle -- but they are spellings of the same
      // sentence rather than different words for it, and a reveal listing
      // *głodny jestem* under **jestem głodna** is telling a learner that word
      // order is optional when what it actually varies with is who is speaking.
      // The word decks have a synonym index to be honest with; this does not.
      also: [],
    });
  });
  decks[lang] = byRank;
  return byRank;
}

/** The phrase at `rank`, or null when the deck has dealt past the end of the list. */
export function phraseQuestion(lang: VocabLang, rank: number): VocabQuestion | null {
  return (decks[lang] ?? build(lang)).get(rank) ?? null;
}

/** Every phrase question in `lang`, for the option builder and the tests. */
export function phraseDeck(lang: VocabLang): ReadonlyMap<number, VocabQuestion> {
  return decks[lang] ?? build(lang);
}

/** Here for the test that holds the laziness. See `vocabDeckIsBuilt`. */
export function phraseDeckIsBuilt(lang: VocabLang): boolean {
  return decks[lang] !== undefined;
}
