// Einkaufslisten-Logik ohne DOM: Abteilungen erkennen, Zutaten der geplanten Gerichte
// zusammenfassen, Abhak-Stand auswerten und die Liste als Text ausgeben. Läuft auch in Node.

import { zutatSchluessel, produktName, zusammenfassen, teileAlsText, inBasis, skaliere } from './zutaten.js';
import { wochenstart, plusTage, heute } from './datum.js';

// ---------------------------------------------------------------- Abteilungen

/** Abteilungen in der Standard-Reihenfolge eines Supermarkts. */
export const ABTEILUNGEN = Object.freeze([
  ['obst-gemuese', 'Obst & Gemüse'], ['brot', 'Brot & Backwaren'], ['fleisch', 'Fleisch & Wurst'],
  ['fisch', 'Fisch'], ['molkerei', 'Milch, Butter & Eier'], ['kaese', 'Käse'], ['kuehl', 'Kühlregal'],
  ['tk', 'Tiefkühl'], ['nudeln-reis', 'Nudeln, Reis & Getreide'], ['backen', 'Backen'], ['gewuerze', 'Gewürze'],
  ['oel-essig', 'Öl & Essig'], ['saucen', 'Saucen & Brühe'], ['konserven', 'Konserven'],
  ['nuesse', 'Nüsse & Trockenobst'], ['fruehstueck', 'Frühstück'], ['suesses', 'Süßes & Snacks'],
  ['getraenke', 'Getränke'], ['alkohol', 'Wein & Alkohol'], ['international', 'International'],
  ['haushalt', 'Haushalt'], ['sonstiges', 'Sonstiges'],
].map(([id, name]) => Object.freeze({ id, name })));
const NACH_ID = new Map(ABTEILUNGEN.map((a) => [a.id, a]));

/** ABTEILUNGEN in der Reihenfolge `reihenfolge` (Ids); Fehlende hinten in Standard-Reihenfolge. */
export function sortierteAbteilungen(reihenfolge) {
  if (!Array.isArray(reihenfolge)) return [...ABTEILUNGEN];
  const vorne = [];
  for (const id of reihenfolge) {
    const a = NACH_ID.get(id);
    if (a && !vorne.includes(a)) vorne.push(a);
  }
  return [...vorne, ...ABTEILUNGEN.filter((a) => !vorne.includes(a))];
}

// Stichwörter in Schlüssel-Form (klein, Einzahl). '_' = Leerzeichen, '~' = schwach (zählt nur,
// wenn nichts Genaueres passt), '^' = mitten im Wort nur am Wortanfang, '*' = kurzes Wort auch
// als Wortende ('olivenöl'). Wörter bis 3 Buchstaben zählen sonst nur als ganzes Wort ('ei' ≠ 'reis').
const STICHWOERTER = {
  'obst-gemuese': `suppengrün suppengemüse apfel äpfel banane birne zitrone zitronensaft limette limettensaft orange mandarine clementine
    grapefruit pomelo beere erdbeere himbeere heidelbeere blaubeere johannisbeere brombeere traube weintraube kiwi
    mango ananas melone pfirsich nektarine aprikose pflaume zwetschge zwetschke mirabelle kirsche sauerkirsche feige
    granatapfel granatapfelkern physalis maracuja passionsfrucht papaya litschi kaki rhabarber quitte avocado tomate
    kirschtomate cocktailtomate cherrytomate strauchtomate rispentomate fleischtomate gurke salatgurke zucchini
    aubergine paprika paprikaschote spitzpaprika chili chilischote peperoni peperoncino jalapeño jalapeno pimiento
    zwiebel schalotte lauchzwiebel frühlingszwiebel knoblauch ingwer kartoffel süßkartoffel möhre karotte pastinake
    petersilienwurzel sellerie knollensellerie staudensellerie fenchel lauch porree kohlrabi brokkoli blumenkohl
    romanesco rosenkohl kohl wirsing pak_choi bok_choy spinat blattspinat mangold rucola rauke feldsalat salat
    radicchio chicorée endivie radieschen rettich rote_bete rote_beete kürbis hokkaido butternut spargel zuckerschote
    zuckererbse erbsenschote bohne brechbohne stangenbohne buschbohne maiskolben champignon pilz pfifferling
    seitling shiitake enoki kräuter petersilie schnittlauch basilikum koriander dill minz rosmarin thymian salbei
    estragon kerbel liebstöckel bärlauch kresse sprosse zitronengras melisse gemüse obst ~frucht artischocke okra
    topinambur schwarzwurzel ~schote citron`,
  brot: `brot weißbrot brötchen semmel baguette ciabatta toast fladenbrot pita naan tortilla wrap brezel breze
    croissant knäckebrot zwieback laugen bagel brioche ~burger muffin kuchen pumpernickel`,
  fleisch: `fleisch rind rinder schwein kalb lamm hammel hähnchen hühnchen huhn hühner geflügel pute truthahn
    ente gans gänse wild hirsch reh kaninchen hack hackfleisch gehacktes mett gulasch geschnetzeltes schnitzel
    ~steak rumpsteak entrecote roastbeef ~filet ~brust ~keule ~schenkel kotelett ~braten roulade speck bacon pancetta
    guanciale schinken wurst würstchen wiener salami chorizo mortadella leberkäse fleischkäse leber frikadelle
    bulette hackbällchen ~patty ~nacken ~bauch kassler kasseler lende ~rücken ~haxe ~schulter tafelspitz schmalz`,
  fisch: `fisch lachs lachsforelle forelle kabeljau seelachs dorsch zander scholle rotbarsch barsch pangasius
    hecht karpfen wels dorade wolfsbarsch saibling heilbutt seeteufel makrele hering matjes garnele shrimp krabbe
    scampi gamba muschel tintenfisch calamari oktopus hummer languste surimi kaviar thunfischsteak meeresfrüchte
    rollmops`,
  molkerei: `milch vollmilch buttermilch drink sahne schlagsahne kochsahne schmand sauerrahm rahm crème_fraîche
    fraîche fraiche crème_double creme_double ~creme ~crème quark joghurt jogurt skyr kefir ayran dickmilch butter
    margarine butterschmalz ei eier eigelb eiweiß eiklar hühnerei wachtelei freilandei cuisine beurre œuf œufs lait`,
  kaese: `käse gouda emmentaler edamer tilsiter leerdammer parmesan parmigiano grana pecorino mozzarella burrata
    scamorza feta halloumi ricotta mascarpone camembert brie gorgonzola cheddar raclette gruyère gruyere appenzeller
    manchego roquefort comté provolone taleggio fontina harzer`,
  kuehl: `tofu tempeh seitan teig blätterteig pizzateig hefeteig mürbeteig strudelteig filoteig yufka pizzaboden
    gnocchi tortellini tortelloni ravioli maultasche spätzle schupfnudel knödel kloß klöße hummus antipasti`,
  tk: `tiefkühl eis* eiswürfel pommes rahmspinat fischstäbchen krokette edamame erbse frühlingsrolle`,
  'nudeln-reis': `nudel pasta spaghetti spaghettini penne fusilli farfalle tagliatelle linguine lasagne makkaroni
    maccheroni rigatoni orecchiette conchiglie cannelloni orzo kritharaki glasnudel mie udon soba ramen teigware reis
    basmati risotto arborio couscous bulgur quinoa hirse graupe polenta grieß griess gries amaranth buchweizen linse
    ~dinkel ~getreide`,
  backen: `mehl stärke zucker vanillezucker vanillinzucker puderzucker vanille vanilleschote vanillebohne vanillin
    ~aroma hefe backpulver natron hirschhornsalz pottasche weinstein kakao kakaopulver schokolade kuvertüre
    zartbitter schokotropfen schokoraspel streusel gelatine agar tortenguss sahnesteif puddingpulver pudding
    lebensmittelfarb marzipan fondant oblate orangeat zitronat paniermehl semmelbrösel kokosraspel kokosflocken
    mandelblättchen mandelstift bittermandel gemahlene_mandel gehobelte_mandel gemahlene_haselnuss mohn rosenwasser
    blütenwasser tonkabohne backmischung zuckerguss glasur farine sucre`,
  gewuerze: `salz meersalz fleur_de_sel pfeffer pfefferkorn rauchpaprika rosa_beere pfefferbeere gewürz pulver paprikapulver edelsüß rosenscharf cayenne
    chiliflocken chilipulver curry kurkuma kreuzkümmel cumin kümmel kümmelsamen zimt muskat muskatnuss muskatblüte
    nelke lorbeer piment kardamom anis anissamen sternanis fenchelsamen koriandersamen senfkorn senfsaat senfsamen
    majoran oregano bohnenkraut kräuter_der_provence italienische_kräuter herbes masala hanout safran sumach zaatar
    bockshornklee wacholder wacholderbeere tandoori`,
  'oel-essig': `öl* bratöl essig balsamico aceto condimento verjus ~fett`,
  saucen: `brühe bouillon brühwürfel brühpulver fond senf ketchup mayonnaise mayo remoulade sauce soße sosse
    saucenbinder ~dressing worcester worcestershire tabasco sambal sriracha harissa currypaste ~paste sesampaste
    tahin tahini tomatenmark miso meerrettich chutney relish hoisin teriyaki pesto ajvar aioli`,
  konserven: `konserve passierte_tomate passata passiert stückige_tomate geschälte_tomate tomate_geschält
    tomate_stückig tomate_gehackt gehackte_tomate pizzatomate dosentomate
    polpa kokosmilch kokosnussmilch kokoscreme kichererbse kidneybohne weiße_bohne schwarze_bohne baked_beans
    wachsbohne mais maiskorn maiskölbchen thunfisch sardine sardelle anchovis gewürzgurke essiggurke cornichon
    sauerkraut olive kaper artischockenherz getrocknete_tomate apfelmus weinblatt jackfruit röstzwiebel
    silberzwiebel perlzwiebel`,
  nuesse: `nuss nüsse walnuss haselnuss erdnuss paranuss pekannuss macadamia mandel cashew pinienkern pistazie kern
    kürbiskern sonnenblumenkern sesam leinsamen samen chia rosine sultanine korinthe dattel cranberry cranberries
    trockenobst trockenfrüchte softaprikose studentenfutter`,
  fruehstueck: `müsli muesli cornflakes flakes granola porridge haferflocken ~hafer marmelade konfitüre gelee
    nutella nougatcreme nusscreme schokocreme erdnussbutter aufstrich honig ahornsirup sirup agavendicksaft dicksaft`,
  suesses: `chips keks cookie löffelbiskuit biskuit gummibärchen gummibär cracker salzstange popcorn popcornmais
    schokoriegel ~riegel praline bonbon lakritz waffel kaugummi flips amarettini süßigkeit`,
  getraenke: `wasser mineralwasser sprudel saft schorle limo limonade cola tonic smoothie espresso kaffee
    kaffeebohne kaffeepulver espressopulver tee* teebeutel`,
  alkohol: `wein weißwein rotwein sekt prosecco champagner cidre bier rum wodka vodka gin whisky whiskey likör
    liqueur cognac weinbrand brandy portwein marsala sherry madeira amaretto grappa ouzo aperol campari wermut
    vermouth kirschwasser calvados tequila schnaps obstler`,
  international: `nori alge reispapier wasabi kimchi taco tacoschale enchilada mirin sake reiswein shaoxing
    tamarinde galgant kaffir wasserkastanie bambussprosse panko tempura dashi gochujang kecap ketjap sushi_ingwer
    ~sushi falafel wan_tan`,
  haushalt: `backpapier alufolie folie frischhaltefolie gefrierbeutel müllbeutel spülmittel spülmaschine tabs
    küchenrolle küchenpapier papier serviette toilettenpapier klopapier taschentuch taschentücher waschmittel
    weichspüler zahnpasta zahncreme zahnbürste shampoo duschgel seife deo batterie kerze schwamm putzmittel reiniger
    ~mittel futter katzenstreu windel pflaster kohle grillkohle anzünder auflaufform schwämme`,
};

const STICHWORTE = Object.entries(STICHWOERTER).flatMap(([id, text]) => text.split(/\s+/).filter(Boolean).map((t) => ({
  id,
  wort: t.replace(/[~^*]/g, '').replace(/_/g, ' '),
  schwach: t.includes('~'),
  anfang: t.includes('^'),
  endung: t.includes('*'),
})));

const KRAEUTER = new Set(('petersilie schnittlauch basilikum koriander dill minz rosmarin thymian salbei estragon ' +
  'kerbel liebstöckel bärlauch kräuter melisse zitronengras chili chilischote peperoncino zwiebel knoblauch ingwer')
  .split(' '));
const PILZE = new Set(['pilz', 'champignon', 'pfifferling', 'seitling', 'shiitake', 'enoki']);
// Abteilungen, die bei Dosenware zu 'konserven' werden ('1 Dose Tomaten', 'Thunfisch')
const DOSE_WIRD_KONSERVE = new Set(['obst-gemuese', 'tk', 'fisch', 'fleisch', 'nudeln-reis', 'molkerei', 'kuehl',
  'sonstiges']);
// Beugungs-Endungen, nach denen ein Treffer noch als Wortende gilt ('tomaten passiert', 'butterkekse')
const BEUGUNG = new Set(['', 'n', 'en', 'e', 's', 'es', 'er', 'chen']);
const TRENNER = /[\s\-/]/;

// Bester Stichwort-Treffer: stark vor schwach, Wortende (Kopf des Kompositums) vor Wortmitte,
// dann weiter hinten, dann länger. 'Lachsfilet' → lachs, 'Paprikapulver' → pulver, 'Kirschtomate' → tomate.
function besterTreffer(k) {
  let best = null;
  for (const s of STICHWORTE) {
    for (let pos = k.indexOf(s.wort); pos >= 0; pos = k.indexOf(s.wort, pos + 1)) {
      const ende = pos + s.wort.length;
      const amAnfang = pos === 0 || TRENNER.test(k[pos - 1]);
      let wortEnde = ende;
      while (wortEnde < k.length && !TRENNER.test(k[wortEnde])) wortEnde += 1;
      const rest = k.slice(ende, wortEnde);
      let kopf;
      if (s.wort.length <= 3) {
        if (rest !== '' || !(amAnfang || s.endung)) continue;
        kopf = true;
      } else {
        kopf = BEUGUNG.has(rest);
        if (!kopf && !amAnfang && (s.anfang || s.wort.length < 5)) continue;
      }
      const t = { id: s.id, wort: s.wort, rang: (s.schwach ? 0 : 2) + (kopf ? 1 : 0), ende: kopf ? wortEnde : ende };
      if (!best || t.rang > best.rang || (t.rang === best.rang && (t.ende > best.ende ||
        (t.ende === best.ende && t.wort.length > best.wort.length)))) best = t;
    }
  }
  return best;
}

// Abteilung nur aus dem Text des Schlüssels (ohne Korrekturen); Ergebnisse werden gemerkt.
// Was nach 'in', 'mit' … steht, entscheidet nicht ('Thunfisch in Öl', 'Wasser mit Kohlensäure').
const MERKER = new Map();
const KONSERVE_RE = /(?:^|[\s-])(?:dose|konserve)|aus der dose|im glas|in stücken|in öl|in salzlake|im eigenen saft|eingelegt/;
function abteilungAusText(k) {
  if (MERKER.has(k)) return MERKER.get(k);
  const kern = k.split(/ (?:in|im|mit|ohne|aus|für|vom|von) /)[0];
  const treffer = besterTreffer(kern) ?? besterTreffer(k);
  let id = treffer?.id ?? 'sonstiges';
  if (id !== 'haushalt') {
    if (/(?:^|[\s-])tk(?:$|[\s-])|tiefkühl|tiefgekühlt|tiefgefroren|gefroren/.test(k)) id = 'tk';
    else if (KONSERVE_RE.test(k) && !['getraenke', 'alkohol'].includes(id)) id = 'konserven';
    else if (id === 'obst-gemuese' && /getrocknet/.test(k)) {
      id = KRAEUTER.has(treffer.wort) ? 'gewuerze' : PILZE.has(treffer.wort) ? 'konserven' : 'nuesse';
    } else if (/gemahlen/.test(k) && (id === 'obst-gemuese' || id === 'nuesse')) {
      id = id === 'nuesse' ? 'backen' : 'gewuerze';
    }
  }
  if (MERKER.size > 5000) MERKER.clear();
  MERKER.set(k, id);
  return id;
}

// Korrektur-Eintrag zu einem Schlüssel (Objekt oder Map; gelöschte zählen nicht)
function aliasVon(aliase, key) {
  if (!aliase || key == null) return null;
  const a = aliase instanceof Map ? aliase.get(key) : Object.hasOwn(aliase, key) ? aliase[key] : null;
  return a && typeof a === 'object' && !a.deleted ? a : null;
}

// Schlüssel mit Produkt-Zusatz als Text für die Stichwörter:
// 'tomate, passiert' → 'passierte tomate', 'erbse, dose' → 'erbse aus der dose'
function alsText(k) {
  const i = k.lastIndexOf(', ');
  if (i < 0) return k;
  const zusaetze = k.slice(i + 2).split(' ').filter(Boolean);
  const behaelter = { dose: 'aus der dose', glas: 'im glas' };
  return [...zusaetze.filter((z) => !behaelter[z]).map((z) => `${z}e`), k.slice(0, i),
    ...zusaetze.filter((z) => behaelter[z]).map((z) => behaelter[z])].join(' ');
}

function abteilungIntern(key, aliase, einheiten) {
  const roh = String(key ?? '').trim();
  const korrektur = aliasVon(aliase, roh)?.section;
  if (korrektur && NACH_ID.has(korrektur)) return korrektur;
  // Schlüssel mit Zusatz ('tomate, passiert') sind schon fertig, sonst erst zum Schlüssel machen
  const k = (roh.includes(', ') ? roh.toLowerCase() : zutatSchluessel(roh) || roh.toLowerCase()).replace(/\s+/g, ' ');
  if (!k) return 'sonstiges';
  const id = abteilungAusText(alsText(k));
  const liste = [...(einheiten || [])].filter(Boolean);
  if (liste.length && liste.every((u) => u === 'Dose') && DOSE_WIRD_KONSERVE.has(id)) return 'konserven';
  if (liste.length && liste.every((u) => u === 'Glas') && id === 'obst-gemuese') return 'konserven';
  return id;
}

// Dose/Glas in Notiz oder Name ('Tomaten (aus der Dose)', 'Tomaten aus der Dose')
const DOSE_NOTIZ_RE = /(?:^|[^\p{L}])(?:dosen?|konserven?)(?!\p{L})/iu;
const GLAS_NOTIZ_RE = /(?:^|[^\p{L}])glas(?!\p{L})/iu;
const BEHAELTER_NAME_RE = / (?:aus der dose|aus der konserve|in der dose|aus dem glas|im glas)(?=,|$)/;

// In Löffeln oder Prisen gemessen ist manches Gemüse/Kraut das Gewürz: '1 TL Paprika' → 'paprika, gemahlen',
// '1 TL Thymian' → 'thymian, getrocknet'. Frisch Zerkleinertes ('1 TL Ingwer, gerieben') bleibt Frischware.
const PRISE = new Set(['Prise', 'Msp']);
const GEMAHLEN_LOEFFEL = new Set(['paprika', 'chili', 'peperoncino']);
const GEMAHLEN_PRISE = new Set(['ingwer', 'knoblauch']);
const HOLZIGE_KRAEUTER = new Set(['thymian', 'rosmarin', 'salbei', 'estragon', 'liebstöckel']);
const KEIN_KRAUT = new Set(['zwiebel', 'knoblauch', 'ingwer', 'chili', 'chilischote', 'peperoncino']);
const FRISCH_RE = /frisch|gehackt|gerieben|gepresst|geschnitten|gewürfelt|fein(?!gemahlen)|zerdrückt|blättchen|gezupft/;

function gewuerzForm(k, zutat) {
  const u = zutat?.unit;
  if (!['TL', 'EL', 'Prise', 'Msp'].includes(u) || FRISCH_RE.test(`${zutat.name ?? ''} ${zutat.note ?? ''}`.toLowerCase())) return null;
  if (GEMAHLEN_LOEFFEL.has(k) || (PRISE.has(u) && GEMAHLEN_PRISE.has(k))) return 'gemahlen';
  if (KRAEUTER.has(k) && !KEIN_KRAUT.has(k) && (PRISE.has(u) || (u === 'TL' && HOLZIGE_KRAEUTER.has(k)))) return 'getrocknet';
  return null;
}

/**
 * Schlüssel einer Zutat für die Einkaufsliste: zutatSchluessel samt Produkt-Zusatz aus der Notiz.
 * Frisches aus Dose oder Glas ist ein anderes Produkt: '1 Dose Tomaten' → 'tomate, dose' (Konserven),
 * '3 Tomaten' → 'tomate'. Was ohnehin Konserve ist ('1 Dose Kichererbsen'), behält seinen Schlüssel.
 * Gewürz statt Frischware: '1 TL Paprika' → 'paprika, gemahlen' (Gewürze, nicht bei '2 Paprika').
 */
export function postenSchluessel(zutat) {
  let k = zutatSchluessel(produktName(zutat));
  const form = k && !k.includes(', ') ? gewuerzForm(k, zutat) : null;
  if (form) return `${k}, ${form}`;
  const note = String(zutat?.note ?? '');
  let dose = zutat?.unit === 'Dose' || DOSE_NOTIZ_RE.test(note);
  let glas = !dose && (zutat?.unit === 'Glas' || GLAS_NOTIZ_RE.test(note));
  const m = k.match(BEHAELTER_NAME_RE);
  if (m) {
    k = zutatSchluessel(k.slice(0, m.index) + k.slice(m.index + m[0].length));
    if (m[0].includes('glas')) glas = !dose;
    else dose = true;
  }
  if (!k || k.includes(', ') || (!dose && !glas)) return k;
  const id = abteilungAusText(k);
  if (dose && DOSE_WIRD_KONSERVE.has(id)) return `${k}, dose`;
  if (glas && id === 'obst-gemuese') return `${k}, glas`;
  return k;
}

/**
 * Abteilung zu einem Zusammenführ-Schlüssel: Korrektur (alias.section) → Zusätze (TK, Dose, getrocknet)
 * → Stichwort → 'sonstiges'. `einheiten` (optional): Einheiten der Zeile, z. B. ['Dose'] → Konserven.
 */
export function abteilungVon(key, aliase = {}, einheiten = null) {
  return abteilungIntern(key, aliase, einheiten);
}

/** Abteilung eines eigenen Eintrags wie in der Liste: gewählte Abteilung, sonst aus Name, Notiz und Einheit. */
export function abteilungEintrag(eintrag, aliase = {}) {
  if (NACH_ID.has(eintrag?.section)) return eintrag.section;
  const key = kanonischerSchluessel(postenSchluessel(eintrag), aliase);
  const einheiten = eintrag?.qty != null && eintrag.qty !== '' ? [inBasis(eintrag.qty, eintrag.unit).basis] : [];
  return abteilungIntern(key, aliase, einheiten);
}

/** Folgt alias.kanonisch (höchstens 5 Schritte). Bei Kreisen gewinnt der kleinste Schlüssel im Kreis. */
export function kanonischerSchluessel(key, aliase = {}) {
  const weg = [key];
  let k = key;
  for (let i = 0; i < 5; i += 1) {
    const ziel = aliasVon(aliase, k)?.kanonisch;
    if (!ziel || ziel === k) break;
    const j = weg.indexOf(ziel);
    if (j >= 0) return weg.slice(j).sort()[0];
    weg.push(ziel);
    k = ziel;
  }
  return k;
}

// ---------------------------------------------------------------- Zeitraum und Runde

/** Zeitraum { von, bis } für 'diese-woche' | 'naechste-woche' | 'sieben-tage'. */
export function standardZeitraum(art, heuteKey = heute(), wochenstartTag = 1) {
  const n = wochenstartTag == null || wochenstartTag === '' ? 1 : Number(wochenstartTag);
  const startTag = Number.isInteger(n) && n >= 0 && n <= 6 ? n : 1;
  if (art === 'sieben-tage') return { von: heuteKey, bis: plusTage(heuteKey, 6) };
  const von = plusTage(wochenstart(heuteKey, startTag), art === 'naechste-woche' ? 7 : 0);
  return { von, bis: plusTage(von, 6) };
}

const SLOT_REIHE = { frueh: 0, mittag: 1, abend: 2, snack: 3 };
const TAG_MUSTER = /^\d{4}-\d{2}-\d{2}$/;

// Portionen, die eine andere (abgeschlossene) Runde schon eingekauft hat; 0 = gehört zu dieser Runde
function schonEingekauft(eintrag, runde) {
  return eintrag.tripId == null || eintrag.tripId === runde?.id ? 0 : Number(eintrag.eingekauftPortionen) || 0;
}

/**
 * Plan-Einträge der Runde: Datum in [from, to], nicht gelöscht, noch keiner anderen Runde zugeordnet –
 * oder dort für weniger Portionen eingekauft, als jetzt geplant sind (eingekauftPortionen < servings).
 */
export function planEintraegeFuerRunde(planEintraege, runde) {
  if (!runde || !TAG_MUSTER.test(runde.from ?? '') || !TAG_MUSTER.test(runde.to ?? '')) return [];
  const [von, bis] = runde.from <= runde.to ? [runde.from, runde.to] : [runde.to, runde.from];
  return (planEintraege || [])
    .filter((e) => e && !e.deleted && TAG_MUSTER.test(e.date ?? '') && e.date >= von && e.date <= bis &&
      (e.tripId == null || e.tripId === runde.id || (schonEingekauft(e, runde) > 0 && Number(e.servings) > schonEingekauft(e, runde))))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (SLOT_REIHE[a.slot] ?? 9) - (SLOT_REIHE[b.slot] ?? 9)));
}

/** Portionen, für die ein Eintrag geplant ist (ohne Angabe die des Rezepts, sonst 1). */
export function geplantePortionen(eintrag, rezept) {
  if (Number(eintrag?.servings) > 0) return Number(eintrag.servings);
  return Number(rezept?.servings) > 0 ? Number(rezept.servings) : 1;
}

/**
 * Mehrere offene Runden (z. B. nach dem Einlesen einer Sicherung) → eine. Jedes Gerät wählt dieselbe:
 * die älteste (createdAt, dann id). Abhak-Stände der übrigen wandern zu ihr (je Posten der neuere).
 * → { runde, entfernen: [Runden, gelöscht markiert], zustaende: [Kopien und gelöscht markierte Originale] }
 */
export function offeneRundenVereinen(offene, zustaende = []) {
  const [runde, ...andere] = [...(offene || [])].filter(Boolean)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!runde) return { runde: null, entfernen: [], zustaende: [] };
  const andereIds = new Set(andere.map((t) => t.id));
  const gueltig = (zustaende || []).filter((st) => st && !st.deleted && st.mergeKey != null);
  const bisher = new Map(gueltig.filter((st) => st.tripId === runde.id).map((st) => [st.mergeKey, st]));
  const kopien = new Map();
  const weg = [];
  for (const st of gueltig) {
    if (!andereIds.has(st.tripId)) continue;
    weg.push({ ...st, deleted: true });
    const da = kopien.get(st.mergeKey) ?? bisher.get(st.mergeKey);
    if (da && (da.updatedAt || 0) >= (st.updatedAt || 0)) continue;
    kopien.set(st.mergeKey, { ...st, id: `${runde.id}|${st.mergeKey}`, tripId: runde.id });
  }
  return { runde, entfernen: andere.map((t) => ({ ...t, deleted: true })), zustaende: [...kopien.values(), ...weg] };
}

// ---------------------------------------------------------------- Liste berechnen

const SORTIERUNG = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
const nachName = (a, b) => SORTIERUNG.compare(a.name, b.name) || (a.mergeKey < b.mergeKey ? -1 : 1);
const rund = (x) => Math.round(x * 1e6) / 1e6;
const EPS = 1e-6;

// Gruppen-Überschrift, die als Zutat gespeichert wurde ('Für den Teig:'), zählt nicht
function istZutat(z) {
  if (!z || typeof z !== 'object' || !String(z.name ?? '').trim()) return false;
  return !(z.qty == null && /:\s*$/.test(String(z.raw ?? z.name)));
}

// Faktor Plan-Portionen / Rezept-Portionen (Rezept ohne Angabe = 1, Eintrag ohne Angabe = Rezept);
// schon in einer früheren Runde eingekaufte Portionen zählen nicht mehr
function portionsFaktor(eintrag, rezept, runde) {
  const basis = Number(rezept.servings) > 0 ? Number(rezept.servings) : 1;
  return (geplantePortionen(eintrag, rezept) - schonEingekauft(eintrag, runde)) / basis;
}

// [{ qty, qty2, unit }] → { Basis-Einheit: Menge } (Obergrenze bei Spannen)
function mengenNachBasis(liste) {
  const summe = {};
  for (const t of liste || []) {
    if (!t || t.vague) continue;
    const { menge, basis } = inBasis(t.qty2 ?? t.qty, t.unit);
    if (menge != null && basis != null) summe[basis] = rund((summe[basis] || 0) + menge);
  }
  return summe;
}

// Schon abgehakte Menge in der Einheit eines Teils (Löffel ↔ ml: 1 TL = 5 ml)
function abgehaktIn(abgehakt, unit) {
  const wert = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  let menge = wert(abgehakt[unit]);
  if (unit === 'ml') menge += wert(abgehakt.TL) * 5;
  if (unit === 'TL') menge += wert(abgehakt.ml) / 5;
  return menge;
}

// Abhak-Stand auswerten: erledigt, wenn nichts mehr fehlt; sonst Rest ('noch 2').
// `gedeckt` (Stände mit `eintraege`): Mengen der Gerichte, die beim Abhaken auf der Liste standen – nur für
// sie zählt das Abgehakte. `neu`: die Zeile hat auch andere Gerichte (anderer Zeitraum) → nicht erledigt.
function nachAbhaken(teile, zustand, gedeckt = null, neu = false) {
  if (!zustand?.erledigt) return { erledigt: false, rest: teile };
  const abgehakt = zustand.abgehakt && typeof zustand.abgehakt === 'object' ? zustand.abgehakt : null;
  if (!abgehakt && !gedeckt) return { erledigt: true, rest: [] };
  const rest = [];
  for (const t of teile) {
    let schon = abgehakt ? abgehaktIn(abgehakt, t.unit) : Infinity;
    if (gedeckt) schon = Math.min(schon, abgehaktIn(gedeckt, t.unit));
    if ((t.qty2 ?? t.qty) <= schon + EPS) continue;
    let qty = rund(t.qty - schon);
    let qty2 = t.qty2 == null ? null : rund(t.qty2 - schon);
    if (qty <= EPS) [qty, qty2] = [qty2, null];
    rest.push({ qty, qty2, unit: t.unit });
  }
  return { erledigt: rest.length === 0 && !neu, rest };
}

// 'salz und pfeffer' → ['salz', 'pfeffer'] (ein Komma trennt dagegen den Produkt-Zusatz ab)
const ZUSAMMEN_RE = / und | & |\//;
const teileVon = (key) => (ZUSAMMEN_RE.test(key) ? key.split(ZUSAMMEN_RE).map((t) => zutatSchluessel(t)) : []);
// Schlüssel, für die ein Vorrat-Eintrag steht (auch über Zusammenführungen)
function vorratSchluessel(v, aliase) {
  if (typeof v !== 'string' || !v.trim()) return [];
  return [v, zutatSchluessel(v)].filter(Boolean).flatMap((k) => [k, kanonischerSchluessel(k, aliase)]);
}

// Vorrat: Schlüssel selbst oder 'salz und pfeffer', wenn alle Teile im Vorrat sind
function vorratPruefer(vorrat, aliase) {
  const menge = new Set((vorrat || []).flatMap((v) => vorratSchluessel(v, aliase)));
  return (key) => menge.has(key) || (teileVon(key).length > 0 && teileVon(key).every((k) => menge.has(k)));
}

/** Vorrat-Einträge, wegen derer `key` als Vorrat gilt (für „Nicht mehr Vorrat“; bei 'salz und pfeffer' beide). */
export function vorratEintraegeFuer(key, vorrat = [], aliase = {}) {
  const ziele = new Set([key, ...teileVon(key)]);
  return (vorrat || []).filter((v) => vorratSchluessel(v, aliase).some((k) => ziele.has(k)));
}

/**
 * Berechnet die Einkaufsliste einer Runde → { abteilungen, erledigt, vorrat, anzahlOffen, anzahlGesamt, eintraege,
 * ausgeblendet }. Rezept-Zeilen werden über alle geplanten Gerichte zusammengefasst (Schlüssel: postenSchluessel);
 * eigene Einträge bleiben einzeln. `ausgeblendet`: versteckte Zeilen (nirgends sonst, nicht gezählt).
 */
export function berechneListe({ planEintraege = [], rezepte = [], manuelle = [], zustaende = [], aliase = {},
  vorrat = [], runde = null, reihenfolge = null } = {}) {
  const rezeptMap = rezepte instanceof Map ? rezepte
    : new Map((rezepte || []).filter((r) => r && r.id != null).map((r) => [r.id, r]));
  const eintraege = planEintraegeFuerRunde(planEintraege, runde);
  const posten = [];
  for (const e of eintraege) {
    const r = e.recipeId != null ? rezeptMap.get(e.recipeId) : null;
    if (!r || r.deleted) continue;
    const faktor = portionsFaktor(e, r, runde);
    const quelle = { planEntryId: e.id, recipeId: r.id, titel: r.title || e.title || '', datum: e.date };
    for (const z of r.ingredients || []) {
      if (!istZutat(z)) continue;
      const s = skaliere(z, faktor);
      const key = kanonischerSchluessel(postenSchluessel(z), aliase);
      posten.push({ key, name: produktName(z), qty: s.qty, qty2: s.qty2, unit: z.unit, vague: Boolean(z.vague), quelle });
    }
  }
  const postenNach = new Map(); // Schlüssel → Posten (für die beim Abhaken gedeckten Mengen)
  for (const p of posten) {
    if (!postenNach.has(p.key)) postenNach.set(p.key, []);
    postenNach.get(p.key).push(p);
  }

  // Abhak-Stände dieser Runde
  const zustandNach = new Map();
  for (const st of zustaende || []) {
    if (st && !st.deleted && (st.kind ?? 'state') === 'state' && runde && st.tripId === runde.id) {
      zustandNach.set(st.mergeKey, st);
    }
  }
  const imVorrat = vorratPruefer(vorrat, aliase);
  const zeilen = [];
  const ausgeblendet = [];
  for (const g of zusammenfassen(posten)) {
    const zustand = zustandNach.get(g.key);
    // Abgehakt gilt nur für die Gerichte, die damals auf der Liste standen (Stände ohne `eintraege`: alle)
    let gedeckt = null;
    let neu = false;
    if (zustand?.erledigt && Array.isArray(zustand.eintraege)) {
      const ids = new Set(zustand.eintraege);
      gedeckt = mengenNachBasis((postenNach.get(g.key) || []).filter((p) => ids.has(p.quelle.planEntryId)));
      neu = g.quellen.some((q) => !ids.has(q.planEntryId));
    }
    const { erledigt, rest } = nachAbhaken(g.teile, zustand, gedeckt, neu);
    const zeile = {
      mergeKey: g.key, name: g.name, teile: g.teile, vage: g.vage, text: teileAlsText(g.teile),
      rest, restText: teileAlsText(rest), erledigt, versteckt: Boolean(zustand?.versteckt),
      abteilung: abteilungIntern(g.key, aliase, g.teile.map((t) => t.unit)),
      quellen: g.quellen, manuell: null, imVorrat: imVorrat(g.key),
    };
    (zeile.versteckt ? ausgeblendet : zeilen).push(zeile);
  }

  // Eigene Einträge: eigene Zeile, nie mit Rezept-Zeilen zusammengefasst
  for (const m of manuelle || []) {
    if (!m || m.deleted || (m.kind ?? 'manual') !== 'manual' || !String(m.name ?? '').trim()) continue;
    const teile = m.qty != null && m.qty !== '' ? [{ qty: m.qty, qty2: m.qty2 ?? null, unit: m.unit ?? null }] : [];
    const text = teileAlsText(teile);
    zeilen.push({
      mergeKey: `manuell:${m.id}`, name: String(m.name).trim(), teile, vage: teile.length === 0, text,
      rest: teile, restText: text, erledigt: m.checked === true, versteckt: false,
      abteilung: abteilungEintrag(m, aliase), quellen: [], manuell: m, imVorrat: false,
    });
  }

  const offen = [];
  const erledigt = [];
  const vorratListe = [];
  for (const z of zeilen) (z.imVorrat ? vorratListe : z.erledigt ? erledigt : offen).push(z);
  const abteilungen = sortierteAbteilungen(reihenfolge)
    .map((a) => ({ id: a.id, name: a.name, zeilen: offen.filter((z) => z.abteilung === a.id).sort(nachName) }))
    .filter((a) => a.zeilen.length > 0);
  return {
    abteilungen,
    erledigt: erledigt.sort(nachName),
    vorrat: vorratListe.sort(nachName),
    anzahlOffen: offen.length,
    anzahlGesamt: offen.length + erledigt.length,
    eintraege,
    ausgeblendet: ausgeblendet.sort(nachName),
  };
}

/**
 * Stand zum Speichern beim Abhaken einer Rezept-Zeile: aktuelle Mengen in Basis-Einheiten und die Plan-Einträge,
 * für die eingekauft wurde (wechselt der Zeitraum, gilt der Haken nicht für Gerichte einer anderen Woche).
 * `alt`: bisheriger Stand; galt er ganz anderen Gerichten (anderer Zeitraum derselben Runde), bleibt er mit drin.
 */
export function abhakZustand(zeile, alt = null) {
  const eintraege = [...new Set((zeile?.quellen || []).map((q) => q?.planEntryId).filter((id) => id != null))];
  const stand = { abgehakt: mengenNachBasis(zeile?.teile), erledigt: true, eintraege: eintraege.length ? eintraege : null };
  if (eintraege.length && alt?.erledigt && Array.isArray(alt.eintraege) && alt.eintraege.length
    && alt.eintraege.every((id) => !eintraege.includes(id))) {
    for (const [u, m] of Object.entries(alt.abgehakt || {})) {
      if (Number.isFinite(Number(m))) stand.abgehakt[u] = rund((stand.abgehakt[u] || 0) + Number(m));
    }
    stand.eintraege = [...eintraege, ...alt.eintraege];
  }
  return stand;
}

/** Liste als Text zum Teilen: Titel, je Abteilung '— Name —' und '• 500 g Kartoffeln'. */
export function listeAlsText(liste, { titel } = {}) {
  const zeilen = [];
  if (titel) zeilen.push(String(titel));
  for (const a of liste?.abteilungen || []) {
    const posten = (a.zeilen || []).filter((z) => !z.erledigt && !z.imVorrat);
    if (!posten.length) continue;
    if (zeilen.length) zeilen.push('');
    zeilen.push(`— ${a.name} —`);
    for (const z of posten) {
      const menge = z.manuell ? z.text : z.restText ?? z.text;
      const notiz = z.manuell?.note ? ` (${z.manuell.note})` : '';
      zeilen.push(`• ${[menge, z.name].filter(Boolean).join(' ')}${notiz}`);
    }
  }
  return zeilen.join('\n');
}
