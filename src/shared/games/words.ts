/**
 * The five-letter words a player is allowed to set or guess.
 *
 * This is a *validation* list, not an answer bank: players choose their own
 * words, so nothing here is secret and there is no puzzle to leak. It lives
 * beside the reducer anyway, because only the server ever needs it — the board
 * renders the marks the server computed and never checks a word itself. A
 * dictionary is the last thing worth spending a mobile client's bytes on.
 *
 * It is deliberately permissive: slang, texting shorthand and profanity are all
 * in, because a word game that rejects how people actually talk is a word game
 * people argue with. Slurs are the one exception — nobody wants to be handed
 * one by an opponent they cannot mute.
 *
 * Adding words is the expected kind of change, and the reason the source is a
 * whitespace-separated string rather than an array: paste a line in and it
 * works. `words.test.ts` holds every entry to five letters of lower-case a-z,
 * so a typo is a failing test rather than a word nobody can ever guess.
 */

const RAW = `
about above abuse actor acute admit adopt adult after again agent agree ahead
alarm album alert alien align alike alive allow alloy alone along aloud alpha
alter amber amend among ample angel anger angle angry ankle annoy apart apple
apply arena argue arise armed armor aroma array arrow aside asset atlas attic
audio audit avoid await awake award aware awful bacon badge badly baker bland
blank blast blaze bleak bleed blend bless blind blink bliss block blood bloom
blown blues bluff blunt blurb blush board boast bonus boost booth bored bound
brain brake brand brass brave bread break breed brick bride brief bring brisk
broad broke brook broom brown brush buddy budge build built bulky bunch bunny
burnt burst buyer cabin cable cache camel candy canoe cargo carol carry carve
catch cause cease cedar chain chair chalk charm chart chase cheap cheat check
cheek cheer chess chest chief child chill chirp choir choke chord chose chuck
chunk churn cider cigar civic civil claim clamp clash clasp class clean clear
clerk click cliff climb cling cloak clock clone close cloth cloud clown coach
coast cobra cocoa colon color comet comfy comic coral corny couch cough could
count court cover crack craft cramp crane crash crate crawl crazy cream creek
creep crept crest cried crime crisp crook cross crowd crown crude cruel crumb
crush crust cubic curly curry curse curve cyber cycle daddy daily dairy daisy
dance dandy dated dealt death debit debut decal decay decor decoy defer deity
delay delta dense depot depth derby detox devil diary dicey diner dingy dirty
disco ditch diver dizzy dodge doing dolly donor donut doubt dough dozen draft
drain drake drama drank drape drawn dread dream dress dried drift drill drink
drive droll drone drool droop drove drown drunk dryer dummy dumpy dunes dusty
dwarf dwell dying eager eagle early earth easel eaten eater ebony edged eerie
eight elbow elder elect elite elope elude email ember empty enact ended endow
enemy enjoy enter entry equal equip erase error erupt essay ethic evade event
every evict evoke exact exalt excel exert exile exist extra fable faced facts
faded faint fairy faith false fancy farms fatal fatty fault favor feast fetch
fever fewer fiber field fiend fiery fifth fifty fight filed filet filly filmy
filth final finch finer fired first fishy fixed fizzy flair flake flame flank
flare flash flask fleet flesh flick flier fling flint flirt float flock flood
floor flora flour flown fluid fluke flung flush flute foamy focal focus foggy
folks folly foods force forge forgo forte forth forty forum found frail frame
frank fraud freak freed fresh fried frill frisk frock frost froth frown froze
fruit fudge fully fumes fungi funky funny furry fussy fuzzy gamer gamma gassy
gaunt gauze gavel gecko genie genre ghost ghoul giant giddy gifts girly given
giver glade gland glare glass glaze gleam glide glint gloat globe gloom glory
gloss glove glued gnome going goofy goose gouge grace grade grain grand grant
grape graph grasp grass grate grave gravy graze great greed green greet grief
grill grime grimy grind gripe groan groin groom grope gross group grove growl
grown gruff grunt guard guava guess guest guide guild guilt gully gummy gusto
gusty habit hairy halve handy happy hardy harsh haste hatch haunt haven havoc
hazel heads heard heart heavy hedge hefty hello hence herbs hertz hides hiker
hills hilly hinge hints hippo hitch hoard hobby hoist holds holes holly homer
honey honor horde horns horse hotel hound hours house hovel hover howdy human
humid humor humps hunch hurry husky hydro hyena hyper ideal idiom idiot idler
igloo image imply inbox incur index inept infer inlet inner input irate irony
issue itchy ivory jaded jazzy jeans jelly jerky jewel jiffy jolly joker jolts
joust judge juice juicy jumbo jumpy junky juror kayak kebab keeps kelps khaki
kicks kiddo kills kinky kiosk kitty knack kneel knelt knife knock knots known
koala labor laced lager lamps lance lands lanky lapse large larva laser lasso
latch later laugh layer leach leads leaky leant leapt learn lease leash least
leave ledge leech leery lefty legal lemon lemur level lever libel light liked
liken lilac limbo limit lined linen liner lingo links lions liver llama loads
loans lobby local locks lodge lofty logic login loner loose lorry loser lotus
louse lousy loved lover lower loyal lucid lucky lumps lunar lunch lunge lurch
lured lurid lusty lying lyric macho macro madam madly magic magma maize major
maker mango mania manic manly manor maple march marks marry marsh mason match
mates matte mauve maybe mayor meals means meant meaty medal media medic melee
melon mercy merge merit merry messy metal meter metro micro midst might mimic
mince miner minor minty minus mirth miser missy mixed mixer mocha modal model
modem moist molar moldy money month moody moose moral morph mossy motel motif
motor motto mould mound mount mourn mouse mousy mouth moved mover movie mower
mucky muddy mummy mumps mural murky mushy music musky musty muted myths nacho
nadir naive naked nanny nappy nasal nasty naval navel needy nerve never newer
newly newts nicer niche niece night ninja ninth noble nobly nodes noise noisy
nomad noose north notch noted notes novel nudge nurse nutty nylon oasis obese
occur ocean octet odder oddly offer often olden older olive omega onion onset
opera opted optic orbit order organ other otter ought ounce outdo outer outgo
owing owner oxide ozone paced paddy pagan pager paint paler palms panda panel
panic pants papal paper parka parry parse party pasta paste pasty patch patio
pause paved payee peace peach pearl pedal peers penny perch peril perky pesky
petal petty phase phone photo piano picky piece piety piggy pilot pinch pines
pinky pious pipes pitch pivot pixel pixie pizza place plaid plain plane plank
plant plate plaza plead pleat plied plots pluck plumb plume plump plush poems
poser point poise poker polar polio polls pooch pored ports posed posse pouch
pound pours power prank prawn preen press price pride prime primo print prior
prism privy prize probe prone prong proof props prose proud prove prowl proxy
prude prune psalm pubic pudgy puffy pulls pulpy pulse punch pupil puppy purge
purse pushy putty quack quail quake qualm quart queen query quest queue quick
quiet quill quilt quirk quite quota quote rabbi rabid racer radar radio rainy
raise rally ramps ranch range rangy rapid ratio raven rayon reach react ready
realm rebel rebus rebut recap recut redid refer regal reign relax relay relic
remit renal renew repay repel reply rerun reset resin retro reuse revel rider
ridge rifle right rigid rigor rinse riper risen risky rival river roast robin
robot rocky rodeo rogue roomy roost roots rotor rouge rough round rouse route
rover royal ruddy rugby ruins ruler rumor runny rural rusty saber sadly safer
saint salad salon salsa salve sandy satin sauce saucy sauna saved savor scald
scale scalp scaly scamp scant scare scarf scary scene scent scoff scold scone
scoop scoot scope score scorn scout scowl scram scrap scrub scuba scuff seams
sedan seedy segue seize sells sense serve setup seven sever sewer shack shade
shaft shake shaky shale shall shame shank shape shard share shark sharp shave
shawl shear sheen sheep sheer sheet shelf shell shift shine shiny shire shirk
shirt shoal shock shone shook shoot shore shorn short shout shove shown showy
shred shrew shrub shrug shunt sides siege sieve sight sigma silky silly since
sinew singe sixth sixty sized skier skiff skill skimp skirt skulk skull skunk
slack slain slant slash slate sleek sleep sleet slept slice slide slime slimy
sling slink slope slosh sloth slump slung slunk slurp slush slyly small smart
smash smear smell smelt smile smirk smite smith smock smoke smoky smote snail
snake snaky snare snarl sneak sneer snipe snoop snore snort snout snowy snuff
soapy sober soggy solar solid solve sonar sonic sooth sooty sorry sound south
space spade spank spare spark spasm spawn speak spear speck speed spell spend
spent sperm spice spicy spied spike spiky spill spine spiny spire spite splat
split spoil spoke spoof spook spool spoon spore sport spout spray spree sprig
spurn spurt squad squat squid stack staff stage staid stain stair stake stale
stalk stall stamp stand stank stare stark start stash state stave stead steak
steal steam steed steel steep steer stein stern stick stiff still stilt sting
stink stint stock stoic stoke stole stomp stone stony stood stool stoop store
stork storm story stout stove strap straw stray strip strut stuck study stuff
stump stung stunk stunt style suave sugar suite sulky sunny super surge surly
sushi swamp swank swarm swath swear sweat sweep sweet swell swept swift swill
swine swing swipe swirl swish swoop sword swore sworn syrup table taboo tacit
tacky taffy taken taker tally talon tamer tango tangy tapir tardy tarot taste
tasty tatty taunt tawny teach tease teddy teeth tempo tempt tenor tense tenth
tepid terms terse tests thank theft their theme there these thick thief thigh
thing think third thong thorn those three threw throb throw thumb thump tiara
tidal tiger tight timer timid tipsy tired titan title toast today token tonal
tonic tooth topaz topic torch torso total totem touch tough towel tower toxic
toxin trace track tract trade trail train trait tramp trash tread treat trend
triad trial tribe trick tried tries trill trims tripe trite troll troop trope
trout truce truck truly trump trunk trust truth tulip tumor tunic turbo turns
tutor twang tweak tweed tweet twice twine twins twirl twist tying udder ulcer
ultra uncle uncut under undid undue unfed unfit unify union unite unity unlit
unmet until unwed unzip upper upset urban urged usage usher usual utile utter
vague valet valid valor value valve vapor vault vegan venom venue verge verse
vibes video vigil vigor villa vinyl viola viper viral virus visit visor vista
vital vivid vixen vocal vodka vogue voice voila vomit voted voter vouch vowed
vowel wacky wafer wager wagon waist waive waltz warty waste watch water waved
waver waxen weary weave wedge weedy weigh weird whack whale wharf wheat wheel
where which whiff while whine whiny whirl whisk white whole whoop whose widen
wider widow width wield wilds wimpy wince winch windy wiped wired wiser witch
witty woken woman women woody wooly woozy wordy works world worry worse worst
worth would wound woven wrack wrath wreak wreck wrest wring wrist write wrong
wrote wrung wryly yacht yearn yeast yield yodel young yours youth yummy zebra
zesty zippy zonal zoned

bimbo bloke booze booty brats bruhs chump clout dodgy dopey dorks dorky dweeb
farts feral flaky fluff frick gimme gonna gonzo goons goopy grody gutsy hater
hicks hokey homie hooch hunky hyped janky jerks kinda kooky lamer lanky legit
loony meany mopey moron mucus nerds newbs nifty noobs nosey nutso oomph outta
phony pissy poser punks punky rowdy rubes sassy scuzz shady shank shart sicko
simps skint slobs slugs snide snobs snuck spazz spiel spunk stank stans stonk
stoke sucks swole tipsy tubby turds twerk twerp twits vapes vibed vibey wimps
wonky woops yikes yowza zonks

arses bitch craps damns dicks dicky dildo fanny fecks fucks hells pissy
poops pubes prick shite shits sluts smuts twats wanks whore
`;

/** How long every word in this game is. */
export const WORD_LENGTH = 5;

/**
 * Every accepted word, upper case, because the reducer works in upper case —
 * a `Set` so validating a guess costs the same whether the list holds a
 * thousand words or a hundred thousand.
 */
export const WORDS: ReadonlySet<string> = new Set(
  RAW.split(/\s+/)
    .filter((word) => word.length === WORD_LENGTH)
    .map((word) => word.toUpperCase()),
);

/** The raw source, for the test that holds the list to its own rules. */
export const WORD_SOURCE = RAW;

export function isWord(word: string): boolean {
  return WORDS.has(word.toUpperCase());
}
