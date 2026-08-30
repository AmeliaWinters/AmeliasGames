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
   * Polish carries **all three genders** of any adjective or past tense in
   * here, and that is not a nicety: *jestem głodna*, *jestem głodny* and
   * *jestem głodne* are one sentence said by different people, and a game that
   * marks somebody wrong for describing themselves correctly is not teaching
   * Polish, it is teaching them to lie about themselves in Polish. The neuter
   * is in for the same reason the feminine is, and it is not decoration: this
   * language conjugates the speaker's gender into the past tense of every verb,
   * so *zaspałom* is the difference between a nonbinary learner being able to
   * say they slept in and not. Japanese carries
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
    pl: 'jestem głodna',
    ja: 'onaka ga suita',
    script: 'お腹が空いた',
    also: {
      pl: ['jestem głodny', 'jestem głodne', 'głodna jestem', 'głodny jestem', 'głodne jestem', 'chce mi się jeść'],
      ja: ['onaka suita', 'onaka ga sukimashita'],
    },
  },
  {
    en: 'Are you hungry?',
    pl: 'jesteś głodna?',
    ja: 'onaka suita?',
    script: 'お腹すいた？',
    also: {
      pl: ['jesteś głodny?', 'jesteś głodne?', 'głodna?', 'głodny?', 'głodne?', 'czy jesteś głodna?'],
      ja: ['onaka ga suita ka', 'onaka sukimashita ka'],
    },
  },
  {
    en: "I'm thirsty",
    pl: 'chce mi się pić',
    ja: 'nodo ga kawaita',
    script: '喉が渇いた',
    also: {
      pl: ['jestem spragniona', 'jestem spragniony', 'jestem spragnione', 'pić mi się chce'],
      ja: ['nodo kawaita'],
    },
  },
  {
    en: "I'm sleepy",
    pl: 'jestem śpiąca',
    ja: 'nemui',
    script: '眠い',
    also: {
      pl: ['jestem śpiący', 'jestem śpiące', 'śpiąca jestem', 'śpiący jestem', 'śpiące jestem', 'chce mi się spać', 'spać mi się chce'],
      ja: ['nemui desu'],
    },
  },
  {
    en: 'Are you sleepy?',
    pl: 'jesteś śpiąca?',
    ja: 'nemui desu ka',
    script: '眠いですか',
    also: {
      pl: ['jesteś śpiący?', 'jesteś śpiące?', 'śpiąca?', 'śpiący?', 'śpiące?', 'chce ci się spać?'],
      ja: ['nemui?', 'nemui no'],
    },
  },
  {
    en: "I'm tired",
    pl: 'jestem zmęczona',
    ja: 'tsukareta',
    script: '疲れた',
    also: {
      pl: ['jestem zmęczony', 'jestem zmęczone', 'zmęczona jestem', 'zmęczony jestem', 'zmęczone jestem'],
      ja: ['tsukaremashita', 'tsukareta yo'],
    },
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
    also: {
      pl: ['nie rozumiem cię', 'nie zrozumiałam', 'nie zrozumiałem', 'nie zrozumiałom'],
      ja: ['wakaranai', 'wakannai'],
    },
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
  // Everything from here down is the household block: the sentences two people
  // living together actually say to each other, in a kitchen, a hallway or a
  // doorway. The forty-five above it are a phrasebook -- greetings, the shop,
  // the restaurant -- and a phrasebook is what you need for a week in Kraków,
  // not for a Tuesday in your own flat. These are picked against that: almost
  // nothing here is said to a stranger, and most of it is said to the same
  // person every day.
  //
  // Three things they teach beyond the sentences themselves, and they are the
  // reason these particular sixty rather than sixty others.
  //
  // **Genitive under a negative or a quantity**: *nie mogę znaleźć telefonu*,
  // *potrzebujemy mleka*, *nie zapomnij kluczy*, *chcesz jeszcze?*. It is the
  // case a learner meets on day one and is still getting wrong in year two,
  // and it cannot be taught by a word list, because the word list files
  // *telefon*. It has to arrive inside a sentence somebody says.
  //
  // **Gendered past tenses and adjectives**: *zaspałam* / *zaspałem* /
  // *zaspałom*, *tęskniłam* / *tęskniłem* / *tęskniłom*, *dumna* / *dumny* /
  // *dumne*. All three go in `also`, which is the bargain `Phrase.also` states:
  // whoever is speaking is right about themselves.
  //
  // The **feminine is the canonical one**, here and in the forty-five above it,
  // which is a change from how this list started. The reason is that the
  // canonical form is the one the reveal teaches, a phrasebook that teaches only
  // *jestem głodny* is a phrasebook written for somebody else, and the person
  // this deck is for says *jestem głodna*. Second person goes the same way --
  // *dobrze spałaś?*, *jesteś gotowa?* -- because these are sentences said to a
  // wife.
  //
  // **Aspect, in the frame it lives in**: *zamknij drzwi* with *zamykaj drzwi*
  // beside it, *zrobię pranie* against *robię pranie*. The perfective is the
  // canonical one throughout, because somebody asking for a thing to be done
  // once, now, is what a household request nearly always is.
  {
    en: 'Dinner is ready',
    pl: 'kolacja gotowa',
    ja: 'gohan ga dekita yo',
    script: 'ご飯ができたよ',
    also: {
      pl: ['kolacja jest gotowa', 'jedzenie gotowe', 'obiad gotowy', 'obiad jest gotowy'],
      ja: ['gohan dekita', 'gohan ga dekimashita'],
    },
  },
  {
    en: "What's for dinner?",
    pl: 'co na kolację?',
    ja: 'ban gohan wa nani',
    script: '晩ご飯は何',
    also: {
      pl: ['co jemy na kolację?', 'co dziś na kolację?', 'co na obiad?'],
      ja: ['ban gohan nani', 'yuushoku wa nan desu ka'],
    },
  },
  {
    en: "I'll cook tonight",
    pl: 'dziś ja gotuję',
    ja: 'kyou wa watashi ga tsukuru',
    script: '今日は私が作る',
    also: {
      pl: ['dzisiaj ja gotuję', 'ja dziś gotuję', 'dziś ja ugotuję'],
      ja: ['kyou wa boku ga tsukuru', 'kyou wa watashi ga tsukurimasu'],
    },
  },
  {
    en: 'Can you do the dishes?',
    pl: 'pozmywasz naczynia?',
    ja: 'osara o aratte kuremasu ka',
    script: 'お皿を洗ってくれますか',
    also: {
      pl: ['możesz pozmywać?', 'umyjesz naczynia?', 'pozmywaj naczynia', 'możesz umyć naczynia?'],
      ja: ['osara aratte kureru', 'osara o aratte'],
    },
  },
  {
    en: 'The kettle has boiled',
    pl: 'woda się zagotowała',
    ja: 'oyu ga waita',
    script: 'お湯が沸いた',
    also: {
      pl: ['woda zagotowana', 'czajnik się zagotował', 'woda się zagotowała już'],
      ja: ['oyu waita', 'oyu ga wakimashita'],
    },
  },
  {
    en: 'Do you want some more?',
    pl: 'chcesz jeszcze?',
    ja: 'mou sukoshi iru',
    script: 'もう少しいる',
    also: {
      pl: ['chcesz więcej?', 'jeszcze trochę?', 'dokładka?', 'chcesz dokładkę?'],
      ja: ['mou sukoshi taberu', 'okawari iru'],
    },
  },
  {
    en: "I'm full",
    pl: 'najadłam się',
    ja: 'onaka ippai',
    script: 'お腹いっぱい',
    also: {
      pl: ['najadłem się', 'najadłom się', 'jestem najedzona', 'jestem najedzony', 'jestem najedzone', 'już nie mogę'],
      ja: ['onaka ippai desu', 'mou onaka ippai'],
    },
  },
  {
    en: 'We need milk',
    pl: 'potrzebujemy mleka',
    ja: 'gyuunyuu ga hitsuyou',
    script: '牛乳が必要',
    also: {
      pl: ['brakuje nam mleka', 'trzeba kupić mleko', 'nie mamy mleka'],
      ja: ['gyuunyuu ga nai', 'gyuunyuu kawanai to'],
    },
  },
  {
    en: 'Is there anything to eat?',
    pl: 'jest coś do jedzenia?',
    ja: 'nanika taberu mono aru',
    script: '何か食べる物ある',
    also: {
      pl: ['mamy coś do jedzenia?', 'czy jest coś do jedzenia?', 'co jest do jedzenia?'],
      ja: ['nanka taberu mono aru', 'taberu mono aru'],
    },
  },
  {
    en: 'Put it in the fridge',
    pl: 'włóż to do lodówki',
    ja: 'reizouko ni irete',
    script: '冷蔵庫に入れて',
    also: {
      pl: ['schowaj to do lodówki', 'wsadź to do lodówki', 'włóż do lodówki'],
      ja: ['reizouko ni irete kudasai', 'reizouko ni shimatte'],
    },
  },
  {
    en: "It's burning",
    pl: 'przypala się',
    ja: 'kogeteru',
    script: '焦げてる',
    also: { pl: ['coś się przypala', 'przypaliło się'], ja: ['kogeteru yo', 'kogechatta'] },
  },
  {
    en: "Let's order takeaway",
    pl: 'zamówmy jedzenie',
    ja: 'demae o tanomou',
    script: '出前を頼もう',
    also: {
      pl: ['może zamówimy jedzenie?', 'zamówmy coś', 'zamawiamy coś?'],
      ja: ['demae tanomou', 'deribarii tanomou'],
    },
  },
  {
    en: 'Can you take out the rubbish?',
    pl: 'wyniesiesz śmieci?',
    ja: 'gomi o dashite kuremasu ka',
    script: 'ゴミを出してくれますか',
    also: {
      pl: ['możesz wynieść śmieci?', 'wynieś śmieci', 'wyrzuć śmieci'],
      ja: ['gomi dashite kureru', 'gomi o sutete'],
    },
  },
  {
    en: "I'll do the laundry",
    pl: 'zrobię pranie',
    ja: 'sentaku suru ne',
    script: '洗濯するね',
    also: {
      pl: ['nastawię pranie', 'zrobię dziś pranie', 'wrzucę pranie', 'robię pranie'],
      ja: ['sentaku shimasu', 'sentaku suru'],
    },
  },
  {
    en: 'The washing machine has finished',
    pl: 'pralka skończyła',
    ja: 'sentakuki ga owatta',
    script: '洗濯機が終わった',
    also: {
      pl: ['pranie skończone', 'pralka się skończyła', 'pranie się skończyło'],
      ja: ['sentaku ga owatta', 'sentakuki owatta yo'],
    },
  },
  {
    en: 'Where are my keys?',
    pl: 'gdzie są moje klucze?',
    ja: 'kagi wa doko',
    script: '鍵はどこ',
    also: {
      pl: ['gdzie moje klucze?', 'gdzie są klucze?', 'nie widziałeś moich kluczy?'],
      ja: ['kagi wa doko desu ka', 'watashi no kagi wa doko'],
    },
  },
  {
    en: "I can't find my phone",
    pl: 'nie mogę znaleźć telefonu',
    ja: 'keitai ga mitsukaranai',
    script: '携帯が見つからない',
    also: {
      pl: ['nie mogę znaleźć swojego telefonu', 'zgubiłam telefon', 'zgubiłem telefon', 'zgubiłom telefon'],
      ja: ['sumaho ga mitsukaranai', 'keitai mitsukaranai'],
    },
  },
  {
    en: 'Have you seen my glasses?',
    pl: 'widziałaś moje okulary?',
    ja: 'megane mita',
    script: '眼鏡見た',
    also: {
      pl: ['widziałeś moje okulary?', 'widziałoś moje okulary?', 'nie widziałaś moich okularów?', 'gdzie są moje okulary?'],
      ja: ['megane mimashita ka', 'watashi no megane mita'],
    },
  },
  {
    en: 'Close the window, please',
    pl: 'zamknij okno proszę',
    ja: 'mado o shimete',
    script: '窓を閉めて',
    also: {
      pl: ['zamkniesz okno?', 'proszę zamknij okno', 'możesz zamknąć okno?'],
      ja: ['mado shimete', 'mado o shimete kudasai'],
    },
  },
  {
    en: 'Open the window',
    pl: 'otwórz okno',
    ja: 'mado o akete',
    script: '窓を開けて',
    also: {
      pl: ['otworzysz okno?', 'możesz otworzyć okno?', 'proszę otwórz okno'],
      ja: ['mado akete', 'mado o akete kudasai'],
    },
  },
  {
    en: "It's cold in here",
    pl: 'jest tu zimno',
    ja: 'koko samui',
    script: 'ここ寒い',
    also: {
      pl: ['ale tu zimno', 'zimno tutaj', 'jest tutaj zimno'],
      ja: ['koko wa samui', 'koko samui ne'],
    },
  },
  {
    en: 'Can you turn the music down?',
    pl: 'ściszysz muzykę?',
    ja: 'ongaku o chiisaku shite kuremasu ka',
    script: '音楽を小さくしてくれますか',
    also: {
      pl: ['możesz ściszyć muzykę?', 'ścisz muzykę', 'możesz ściszyć?'],
      ja: ['ongaku chiisaku shite', 'oto o chiisaku shite'],
    },
  },
  {
    en: 'Lock the door',
    pl: 'zamknij drzwi na klucz',
    ja: 'kagi o kakete',
    script: '鍵をかけて',
    also: {
      pl: ['zamknij drzwi', 'zamkniesz drzwi na klucz?', 'zamykaj drzwi'],
      ja: ['kagi kakete', 'kagi o kakete kudasai'],
    },
  },
  {
    en: "Someone's at the door",
    pl: 'ktoś jest przy drzwiach',
    ja: 'dareka kita yo',
    script: '誰か来たよ',
    also: {
      pl: ['ktoś przyszedł', 'ktoś dzwoni do drzwi', 'ktoś puka'],
      ja: ['dareka kiteru', 'dareka kimashita'],
    },
  },
  {
    en: "I'm going to the shop",
    pl: 'idę do sklepu',
    ja: 'mise ni iku',
    script: '店に行く',
    also: {
      pl: ['wychodzę do sklepu', 'skoczę do sklepu', 'idę na zakupy'],
      ja: ['kaimono ni iku', 'mise ni ikimasu'],
    },
  },
  {
    en: 'Do you need anything?',
    pl: 'potrzebujesz czegoś?',
    ja: 'nanika iru',
    script: '何かいる',
    also: {
      pl: ['czy czegoś potrzebujesz?', 'coś ci potrzeba?', 'przynieść ci coś?'],
      ja: ['nanka iru', 'nanika irimasu ka'],
    },
  },
  {
    en: "I'll be back in a minute",
    pl: 'zaraz wracam',
    ja: 'sugu modoru',
    script: 'すぐ戻る',
    also: {
      pl: ['zaraz wrócę', 'wracam za chwilę', 'za chwilę wracam'],
      ja: ['sugu modorimasu', 'sugu kaeru'],
    },
  },
  {
    en: 'Did you sleep well?',
    pl: 'dobrze spałaś?',
    ja: 'yoku nemureta',
    script: 'よく眠れた',
    also: {
      pl: ['dobrze spałeś?', 'dobrze spałoś?', 'wyspałaś się?', 'wyspałeś się?', 'wyspałoś się?', 'jak spałaś?'],
      ja: ['yoku nemuremashita ka', 'yoku neta'],
    },
  },
  {
    en: "I'm going to bed",
    pl: 'idę spać',
    ja: 'mou neru',
    script: 'もう寝る',
    also: {
      pl: ['kładę się spać', 'idę już spać', 'idę do łóżka'],
      ja: ['neru ne', 'mou nemasu'],
    },
  },
  {
    en: 'Wake me up at seven',
    pl: 'obudź mnie o siódmej',
    ja: 'shichiji ni okoshite',
    script: '七時に起こして',
    also: {
      pl: ['obudzisz mnie o siódmej?', 'możesz mnie obudzić o siódmej?'],
      ja: ['shichiji ni okoshite kudasai', 'nanaji ni okoshite'],
    },
  },
  {
    en: 'Five more minutes',
    pl: 'jeszcze pięć minut',
    ja: 'ato gofun',
    script: 'あと五分',
    also: { pl: ['jeszcze pięć minutek', 'pięć minut jeszcze'], ja: ['ato gofun dake', 'mou gofun'] },
  },
  {
    en: 'Sweet dreams',
    pl: 'słodkich snów',
    ja: 'ii yume o',
    script: 'いい夢を',
    also: { pl: ['kolorowych snów', 'śpij dobrze'], ja: ['ii yume o mite ne', 'yoi yume o'] },
  },
  {
    en: 'I overslept',
    pl: 'zaspałam',
    ja: 'neboushita',
    script: '寝坊した',
    also: {
      pl: ['zaspałem', 'zaspałom', 'zaspałyśmy', 'zaspaliśmy'],
      ja: ['neboushimashita', 'nebou shichatta'],
    },
  },
  {
    en: 'I missed you',
    pl: 'tęskniłam za tobą',
    ja: 'aitakatta',
    script: '会いたかった',
    also: {
      pl: ['tęskniłem za tobą', 'tęskniłom za tobą', 'tęskniłam', 'tęskniłem', 'tęskniłom'],
      ja: ['aitakatta yo', 'samishikatta'],
    },
  },
  {
    en: 'Give me a hug',
    pl: 'przytul mnie',
    ja: 'gyutto shite',
    script: 'ぎゅっとして',
    also: { pl: ['przytulisz mnie?', 'chodź się przytulić'], ja: ['hagu shite', 'gyuu shite'] },
  },
  {
    en: 'You look lovely today',
    pl: 'ładnie dziś wyglądasz',
    ja: 'kyou suteki da ne',
    script: '今日素敵だね',
    also: {
      pl: ['pięknie dziś wyglądasz', 'ślicznie wyglądasz', 'dobrze wyglądasz'],
      ja: ['kyou suteki desu ne', 'kyou kirei da ne'],
    },
  },
  {
    en: 'I love you too',
    pl: 'ja ciebie też kocham',
    ja: 'watashi mo aishiteru',
    script: '私も愛してる',
    also: { pl: ['też cię kocham', 'ja też cię kocham'], ja: ['boku mo aishiteru', 'watashi mo daisuki'] },
  },
  {
    en: "Don't worry",
    pl: 'nie martw się',
    ja: 'shinpai shinaide',
    script: '心配しないで',
    also: {
      pl: ['spokojnie', 'nie przejmuj się', 'bez obaw'],
      ja: ['shinpai nai yo', 'shinpai shinakute ii'],
    },
  },
  {
    en: "I'm proud of you",
    pl: 'jestem z ciebie dumna',
    ja: 'hokori ni omou yo',
    script: '誇りに思うよ',
    also: {
      pl: ['jestem z ciebie dumny', 'jestem z ciebie dumne', 'dumna jestem', 'dumny jestem', 'dumne jestem'],
      ja: ['hokori ni omoimasu', 'sugoi to omou yo'],
    },
  },
  {
    en: "What's wrong?",
    pl: 'co się stało?',
    ja: 'dou shita no',
    script: 'どうしたの',
    also: { pl: ['co jest?', 'coś nie tak?', 'co ci jest?'], ja: ['dou shita', 'doushitan desu ka'] },
  },
  {
    en: "It's my fault",
    pl: 'to moja wina',
    ja: 'watashi no sei',
    script: '私のせい',
    also: { pl: ['moja wina', 'to była moja wina'], ja: ['boku no sei', 'watashi no sei desu'] },
  },
  {
    en: 'Are you okay?',
    pl: 'nic ci nie jest?',
    ja: 'daijoubu?',
    script: '大丈夫？',
    also: {
      pl: ['wszystko okej?', 'czy nic ci nie jest?', 'nic się nie stało?'],
      ja: ['daijoubu ka', 'daijoubu kana'],
    },
  },
  {
    en: 'What time will you be home?',
    pl: 'o której będziesz w domu?',
    ja: 'nanji ni kaeru',
    script: '何時に帰る',
    also: {
      pl: ['o której wracasz?', 'kiedy będziesz w domu?', 'o której wrócisz?'],
      ja: ['nanji ni kaerimasu ka', 'nanji ni kaeru no'],
    },
  },
  {
    en: "I'm on my way home",
    pl: 'wracam do domu',
    ja: 'ima kaeru tokoro',
    script: '今帰るところ',
    also: {
      pl: ['jestem w drodze do domu', 'już wracam', 'jadę do domu'],
      ja: ['ima kaetteru', 'kaeru tochuu'],
    },
  },
  {
    en: "I'll be late",
    pl: 'spóźnię się',
    ja: 'okureru',
    script: '遅れる',
    also: {
      pl: ['trochę się spóźnię', 'spóźnię się dziś', 'będę później'],
      ja: ['okuremasu', 'chotto okureru'],
    },
  },
  {
    en: 'Are you ready?',
    pl: 'jesteś gotowa?',
    ja: 'junbi dekita',
    script: '準備できた',
    also: {
      pl: ['jesteś gotowy?', 'jesteś gotowe?', 'gotowa?', 'gotowy?', 'gotowe?', 'możemy iść?'],
      ja: ['junbi dekimashita ka', 'junbi dekita no'],
    },
  },
  {
    en: "Let's watch a film",
    pl: 'obejrzyjmy film',
    ja: 'eiga o miyou',
    script: '映画を見よう',
    also: {
      pl: ['może film?', 'obejrzymy film?', 'oglądniemy jakiś film?'],
      ja: ['eiga miyou', 'eiga o mimashou'],
    },
  },
  {
    en: 'What do you want to do today?',
    pl: 'co chcesz dziś robić?',
    ja: 'kyou nani shitai',
    script: '今日何したい',
    also: {
      pl: ['co robimy dzisiaj?', 'co chcesz dzisiaj robić?', 'na co masz ochotę?'],
      ja: ['kyou wa nani shitai', 'kyou nani suru'],
    },
  },
  {
    en: "Let's go for a walk",
    pl: 'chodźmy na spacer',
    ja: 'sanpo ni ikou',
    script: '散歩に行こう',
    also: {
      pl: ['idziemy na spacer?', 'może spacer?', 'pójdziemy na spacer?'],
      ja: ['sanpo shiyou', 'sanpo ni ikimashou'],
    },
  },
  {
    en: "It's raining",
    pl: 'pada deszcz',
    ja: 'ame ga futteru',
    script: '雨が降ってる',
    also: { pl: ['pada', 'leje', 'deszcz pada'], ja: ['ame futteru', 'ame ga futte imasu'] },
  },
  {
    en: 'The weather is beautiful',
    pl: 'jest piękna pogoda',
    ja: 'ii tenki da ne',
    script: 'いい天気だね',
    also: {
      pl: ['piękna pogoda', 'ładna pogoda', 'jaka piękna pogoda'],
      ja: ['ii tenki desu ne', 'tenki ga ii'],
    },
  },
  {
    en: 'Have a good day',
    pl: 'miłego dnia',
    ja: 'itterasshai',
    script: 'いってらっしゃい',
    also: { pl: ['udanego dnia', 'życzę miłego dnia'], ja: ['ii ichinichi o', 'itte rasshai'] },
  },
  {
    en: 'Call me',
    pl: 'zadzwoń do mnie',
    ja: 'denwa shite',
    script: '電話して',
    also: { pl: ['zadzwoń', 'odezwij się'], ja: ['denwa shite ne', 'denwa choudai'] },
  },
  {
    en: 'Can you pass me that?',
    pl: 'podasz mi to?',
    ja: 'sore totte kuremasu ka',
    script: 'それ取ってくれますか',
    also: {
      pl: ['możesz mi to podać?', 'podaj mi to', 'podasz mi tamto?'],
      ja: ['sore totte', 'sore o totte kudasai'],
    },
  },
  {
    en: 'Come here',
    pl: 'chodź tutaj',
    ja: 'kocchi kite',
    script: 'こっち来て',
    also: { pl: ['chodź tu', 'podejdź tutaj'], ja: ['kocchi ni kite', 'koko ni kite'] },
  },
  {
    en: "I'm coming",
    pl: 'już idę',
    ja: 'ima iku',
    script: '今行く',
    also: { pl: ['idę', 'zaraz będę', 'już biegnę'], ja: ['ima ikimasu', 'sugu iku'] },
  },
  {
    en: 'Sit down',
    pl: 'usiądź',
    ja: 'suwatte',
    script: '座って',
    also: { pl: ['siadaj', 'usiądź proszę', 'proszę usiąść'], ja: ['suwatte kudasai', 'koshikakete'] },
  },
  {
    en: "Don't forget your keys",
    pl: 'nie zapomnij kluczy',
    ja: 'kagi wasurenaide',
    script: '鍵忘れないで',
    also: {
      pl: ['pamiętaj o kluczach', 'nie zapomnij o kluczach'],
      ja: ['kagi o wasurenaide', 'kagi wasurenai de ne'],
    },
  },
  {
    en: 'Good luck',
    pl: 'powodzenia',
    ja: 'ganbatte',
    script: '頑張って',
    also: { pl: ['trzymam kciuki', 'połamania nóg'], ja: ['ganbatte ne', 'ganbare'] },
  },
  {
    en: 'Thank you for everything',
    pl: 'dziękuję za wszystko',
    ja: 'iroiro arigatou',
    script: '色々ありがとう',
    also: {
      pl: ['dzięki za wszystko', 'dziękuję ci za wszystko'],
      ja: ['iroiro arigatou gozaimasu', 'iroiro doumo'],
    },
  },
  // The last eleven are the household saying who lives in it.
  //
  // A phrasebook's idea of a couple is *mój mąż* and nothing else, and a
  // learner whose wife is a wife spends the first year translating around the
  // book they paid for. *To moja żona* is one word different and it is the
  // difference between a sentence you can use and a sentence you have to fix
  // every time. The accusative in *kocham moją żonę* is the same free lesson
  // the genitive block above gets: nobody learns a case from a paradigm, they
  // learn it from a sentence they say twice a week.
  //
  // *Moje zaimki to ono* is here for the same reason the neuter forms are in
  // `also` throughout: Polish makes you declare a gender in the past tense of
  // every verb, so a language that will not conjugate you is a language you
  // cannot say Tuesday in. The neuter (*zaspałom*, *jestem zmęczone*) is the
  // form nonbinary Polish speakers have actually settled on, which is why it is
  // the one taught here rather than the invented pronoun sets; those exist and
  // are real to the people who use them, but a game cannot mark six competing
  // systems right and this one is the one a learner will hear.
  {
    en: 'This is my wife',
    pl: 'to moja żona',
    ja: 'tsuma desu',
    script: '妻です',
    also: {
      pl: ['to jest moja żona', 'moja żona', 'poznaj moją żonę'],
      ja: ['watashi no tsuma desu', 'tsuma da yo'],
    },
  },
  {
    en: 'I love my wife',
    pl: 'kocham moją żonę',
    ja: 'tsuma o aishiteru',
    script: '妻を愛してる',
    also: {
      pl: ['kocham swoją żonę', 'bardzo kocham moją żonę'],
      ja: ['tsuma ga daisuki', 'tsuma o aishiteimasu'],
    },
  },
  {
    en: "She's my partner",
    pl: 'to moja partnerka',
    ja: 'paatonaa desu',
    script: 'パートナーです',
    also: {
      pl: ['to jest moja partnerka', 'moja partnerka', 'to moja dziewczyna'],
      ja: ['watashi no paatonaa desu', 'paatonaa da yo'],
    },
  },
  {
    en: "I'm going out with my girlfriend",
    pl: 'wychodzę z dziewczyną',
    ja: 'kanojo to dekakeru',
    script: '彼女と出かける',
    also: {
      pl: ['wychodzę ze swoją dziewczyną', 'idę z dziewczyną', 'umówiłam się z dziewczyną'],
      ja: ['kanojo to dekakemasu', 'kanojo to asobi ni iku'],
    },
  },
  {
    en: 'Will you marry me?',
    pl: 'wyjdziesz za mnie?',
    ja: 'kekkon shite kuremasu ka',
    script: '結婚してくれますか',
    also: {
      pl: ['poślubisz mnie?', 'weźmiesz ze mną ślub?', 'czy wyjdziesz za mnie?'],
      ja: ['kekkon shite kureru', 'kekkon shiyou'],
    },
  },
  {
    en: "We're getting married",
    pl: 'bierzemy ślub',
    ja: 'kekkon suru yo',
    script: '結婚するよ',
    also: {
      pl: ['pobieramy się', 'będziemy brać ślub', 'zaręczyłyśmy się'],
      ja: ['kekkon shimasu', 'kekkon suru n da'],
    },
  },
  {
    en: 'Happy anniversary',
    pl: 'szczęśliwej rocznicy',
    ja: 'kekkon kinenbi omedetou',
    script: '結婚記念日おめでとう',
    also: {
      pl: ['wszystkiego najlepszego w rocznicę', 'gratulacje z okazji rocznicy'],
      ja: ['kinenbi omedetou', 'kekkon kinenbi omedetou gozaimasu'],
    },
  },
  {
    en: 'Kiss me',
    pl: 'pocałuj mnie',
    ja: 'kisu shite',
    script: 'キスして',
    also: { pl: ['całuj mnie', 'daj buziaka'], ja: ['kisu shite ne', 'chuu shite'] },
  },
  {
    en: 'My pronouns are ono',
    pl: 'moje zaimki to ono',
    ja: 'daimeishi wa they desu',
    script: '代名詞はtheyです',
    also: {
      pl: ['używam zaimków ono', 'mówcie do mnie ono', 'moje zaimki to ono ich jemu'],
      ja: ['daimeishi wa they them desu', 'watashi no daimeishi wa they desu'],
    },
  },
  {
    en: "I'm nonbinary",
    pl: 'jestem osobą niebinarną',
    ja: 'nonbainarii desu',
    script: 'ノンバイナリーです',
    also: {
      pl: ['jestem niebinarna', 'jestem niebinarne', 'jestem niebinarny'],
      ja: ['nonbainarii da yo', 'watashi wa nonbainarii desu'],
    },
  },
  {
    en: 'Are you coming to Pride with me?',
    pl: 'idziesz ze mną na paradę równości?',
    ja: 'puraido ni issho ni iku',
    script: 'プライドに一緒に行く',
    also: {
      pl: ['pójdziesz ze mną na paradę?', 'idziesz na paradę równości?', 'idziemy na paradę?'],
      ja: ['puraido ni issho ni ikimasu ka', 'puraido ikou'],
    },
  },
  // The wedding block. The ones above are about being with somebody; these are
  // about the six months where that turns into a event with a guest list, and
  // they are the sentences that get said daily in that stretch and then never
  // again. Polish declares the speaker's gender in every past tense here too,
  // so *zaraczy*-shaped verbs carry all three in `also` for the same reason
  // the rest of the list does.
  {
    en: 'This is my fiancee',
    pl: 'to moja narzeczona',
    ja: 'konyakusha desu',
    script: '婚約者です',
    also: {
      pl: ['to jest moja narzeczona', 'moja narzeczona', 'to mój narzeczony'],
      ja: ['watashi no konyakusha desu', 'konyakusha da yo', 'fianse desu'],
    },
  },
  {
    en: 'We got engaged',
    pl: 'zaręczyłyśmy się',
    ja: 'konyaku shita',
    script: '婚約した',
    also: {
      pl: ['zaręczyliśmy się', 'jesteśmy zaręczone', 'jesteśmy zaręczeni'],
      ja: ['konyaku shimashita', 'konyaku shita yo'],
    },
  },
  {
    en: 'Do you like the ring?',
    pl: 'podoba ci się pierścionek?',
    ja: 'yubiwa kiniitta',
    script: '指輪気に入った',
    also: {
      pl: ['podoba ci się ten pierścionek?', 'jak ci się podoba pierścionek?'],
      ja: ['yubiwa kiniitta', 'yubiwa ki ni irimashita ka'],
    },
  },
  {
    en: 'When is the wedding?',
    pl: 'kiedy jest ślub?',
    ja: 'kekkonshiki wa itsu',
    script: '結婚式はいつ',
    also: {
      pl: ['kiedy macie ślub?', 'kiedy bierzecie ślub?'],
      ja: ['kekkonshiki wa itsu desu ka', 'shiki wa itsu'],
    },
  },
  {
    en: 'The wedding is in June',
    pl: 'ślub jest w czerwcu',
    ja: 'kekkonshiki wa rokugatsu desu',
    script: '結婚式は六月です',
    also: {
      pl: ['bierzemy ślub w czerwcu', 'ślub w czerwcu'],
      ja: ['kekkonshiki wa rokugatsu', 'rokugatsu ni kekkon shimasu'],
    },
  },
  {
    en: "I'm looking for a wedding dress",
    pl: 'szukam sukni ślubnej',
    ja: 'uedingu doresu o sagashiteru',
    script: 'ウェディングドレスを探してる',
    also: {
      pl: ['szukam sukienki ślubnej', 'szukam garnituru na ślub'],
      ja: ['uedingu doresu o sagashiteimasu', 'doresu o sagashiteru'],
    },
  },
  {
    en: 'Will you be my bridesmaid?',
    pl: 'będziesz moją druhną?',
    ja: 'buraidzumeido ni natte kureru',
    script: 'ブライズメイドになってくれる',
    also: {
      pl: ['czy będziesz moją druhną?', 'będziesz świadkową?', 'będziesz moim świadkiem?'],
      ja: ['buraidzumeido ni natte kuremasu ka', 'hanayome no tsukisoi o onegai'],
    },
  },
  {
    en: 'Have you sent the invitations?',
    pl: 'wysłałaś zaproszenia?',
    ja: 'shoutaijou wa okutta',
    script: '招待状は送った',
    also: {
      pl: ['wysłałeś zaproszenia?', 'wysłałoś zaproszenia?', 'zaproszenia wysłane?'],
      ja: ['shoutaijou wa okurimashita ka', 'shoutaijou okutta'],
    },
  },
  {
    en: "We're inviting fifty guests",
    pl: 'zapraszamy pięćdziesięciu gości',
    ja: 'gojuunin shoutai suru',
    script: '五十人招待する',
    also: {
      pl: ['będzie pięćdziesięciu gości', 'zapraszamy pięćdziesiąt osób'],
      ja: ['gojuunin shoutai shimasu', 'gojuunin kuru yo'],
    },
  },
  {
    en: 'Save me the first dance',
    pl: 'zatańcz ze mną pierwszy taniec',
    ja: 'saisho no dansu wa boku to',
    script: '最初のダンスは僕と',
    also: {
      pl: ['pierwszy taniec jest mój', 'zatańczymy pierwszy taniec?'],
      ja: ['saisho no dansu wa watashi to', 'faasuto dansu wa issho ni'],
    },
  },
  {
    en: "I can't wait to marry you",
    pl: 'nie mogę się doczekać ślubu z tobą',
    ja: 'hayaku kekkon shitai',
    script: '早く結婚したい',
    also: {
      pl: ['nie mogę się doczekać naszego ślubu', 'już nie mogę się doczekać ślubu'],
      ja: ['hayaku kekkon shitai na', 'kekkon suru no ga machidooshii'],
    },
  },
  {
    en: 'Congratulations to the newlyweds',
    pl: 'gratulacje dla nowożeńców',
    ja: 'gokekkon omedetou',
    script: 'ご結婚おめでとう',
    also: {
      pl: ['wszystkiego najlepszego dla młodej pary', 'gratulacje dla młodej pary'],
      ja: ['gokekkon omedetou gozaimasu', 'kekkon omedetou'],
    },
  },
  {
    en: "We're on our honeymoon",
    pl: 'jesteśmy w podróży poślubnej',
    ja: 'shinkon ryokou chuu desu',
    script: '新婚旅行中です',
    also: {
      pl: ['mamy podróż poślubną', 'jedziemy w podróż poślubną'],
      ja: ['shinkon ryokou chuu', 'hanemuun chuu desu'],
    },
  },
  {
    en: 'I will love you always',
    pl: 'będę cię kochać zawsze',
    ja: 'zutto aishiteru',
    script: 'ずっと愛してる',
    also: {
      pl: ['zawsze będę cię kochać', 'kocham cię na zawsze'],
      ja: ['zutto aishiteru yo', 'itsumademo aishiteimasu'],
    },
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
