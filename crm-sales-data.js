/* DANKO Sales Agent — MOCK ДАННИ (само за режим Mock!).
   Това е ИЗОЛИРАН примерен набор по модела на реалния CRM (Google Sheet
   „DANKO Sales Leads" → Qualified Leads, 47 компании). Числата и фирмите са
   реалистични, но измислени. UI кодът НЕ бърка тук директно — всичко минава
   през salesAgentApi (crm-sales-api.js), за да се смени безболезнено с
   реалните n8n endpoints.

   КАРТА НА ПОЛЕТАТА (backend име ↔ ключ тук — НЕ преименуваме смислово):
   Date Added→dateAdded · Company→company · Country→country · Website→website
   Industry→industry · Description→description · Products→products
   Processes→processes · DANKO Fit Score→fitScore
   Potential Opportunity→potentialOpportunity · Status→status
   Decision Maker Role→decisionMakerRole · Contact Person→contactPerson
   Email→email · LinkedIn→linkedin · Business Phone→businessPhone
   Contact Source URL→contactSourceUrl · Sales Approach→salesApproach
   Verified Facts→verifiedFacts · Inferences→inferences · Sources→sources
   Notes→notes · Outreach Status→outreachStatus · Outreach Date→outreachDate
   Outreach Email→outreachEmail · Outreach Subject→outreachSubject
   Stage2 Needed→stage2Needed · Outreach Eligible→outreachEligible
   Идентичност на компания = website (домейн), НЕ името. */

const CRM_MOCK = {
  meta: { source: `MOCK — примерни данни по модела на DANKO Sales Leads (47 реални записа, редове 2–48)`, totalReal: 47 },
  companies: [
    {
      dateAdded: "2026-09-18", company: "Maschinenbau Krüger GmbH", country: "Germany",
      website: "krueger-maschinenbau.de", industry: "Industrial machinery",
      description: "Семейна фирма за специални машини и заваръчни конструкции за автомобилни доставчици.",
      products: "Специални машини, рамки, конвейерни модули", processes: "Лазерно рязане, огъване, заваряване, прахово боядисване",
      fitScore: 94, potentialOpportunity: "Аутсорсинг на заварени възли и лазерни детайли при пикове.",
      status: "RESEARCH_COMPLETE", stage2Needed: false, outreachEligible: true,
      decisionMakerRole: "Head of Purchasing", contactPerson: "Stefan Krüger", email: "s.krueger@krueger-maschinenbau.de",
      linkedin: "linkedin.com/in/stefan-krueger-mb", businessPhone: "+49 7031 22 44 60", contactSourceUrl: "krueger-maschinenbau.de/kontakt",
      salesApproach: "Кратък имейл на немски: капацитет за заварени възли + серт. ISO 3834, реф. автомобилни доставчици.",
      verifiedFacts: "120 служители; 3 обекта; търсят подизпълнители (карирера страница).", inferences: "Вероятен недостиг на заварчици.",
      sources: "Сайт, Impressum, LinkedIn", notes: "Реагирал на подобни кампании (Stage 2).",
      outreachStatus: "DRAFT_CREATED", outreachDate: "2026-09-20", outreachEmail: "s.krueger@krueger-maschinenbau.de",
      outreachSubject: "Fertigungskapazität für Schweißbaugruppen — DANKO Systems"
    },
    {
      dateAdded: "2026-09-18", company: "Officine Meccaniche Bertolini S.r.l.", country: "Italy",
      website: "ombertolini.it", industry: "Machine builders",
      description: "Производител на опаковъчни линии и машини за хранителната индустрия.",
      products: "Машини за пълнене, конвейери", processes: "Механична обработка, монтаж",
      fitScore: 88, potentialOpportunity: "Лазерно рязани и огънати детайли от неръждаема стомана.",
      status: "RESEARCH_COMPLETE", stage2Needed: false, outreachEligible: true,
      decisionMakerRole: "Operations Director", contactPerson: "Luca Bertolini", email: "l.bertolini@ombertolini.it",
      linkedin: "linkedin.com/in/luca-bertolini-om", businessPhone: "+39 0522 91 42 77", contactSourceUrl: "ombertolini.it/azienda",
      salesApproach: "Имейл на английски/италиански: inox детайли, бързи срокове, ЕС локация.",
      verifiedFacts: "Изнасят 70% в ЕС; сертифицирани EN 1090.", inferences: "Купуват детайли отвън (малък собствен цех).",
      sources: "Сайт, регистър, LinkedIn", notes: "",
      outreachStatus: "READY", outreachDate: "", outreachEmail: "", outreachSubject: ""
    },
    {
      dateAdded: "2026-09-19", company: "Van der Meer Machinefabriek B.V.", country: "Netherlands",
      website: "vdm-machinefabriek.nl", industry: "Industrial equipment manufacturers",
      description: "Машиностроене и рамкови конструкции за агро-техника.",
      products: "Рамки, шасита, хидравлични стойки", processes: "Заваряване, обработка, боя",
      fitScore: 91, potentialOpportunity: "Серийни заварени рамки с прахово покритие.",
      status: "RESEARCH_COMPLETE", stage2Needed: false, outreachEligible: false,
      decisionMakerRole: "Supply Chain Manager", contactPerson: "Jeroen van Dijk", email: "",
      linkedin: "linkedin.com/in/jeroenvandijk-vdm", businessPhone: "+31 512 33 90 12", contactSourceUrl: "vdm-machinefabriek.nl/contact",
      salesApproach: "Първо LinkedIn (няма потвърден имейл), после телефон.",
      verifiedFacts: "Ръст 2 г. подред; нова производствена хала 2025.", inferences: "Търсят капацитет навън.",
      sources: "Сайт, KvK, LinkedIn", notes: "ЛИПСВА ПОТВЪРДЕН ИМЕЙЛ — за ръчна проверка.",
      outreachStatus: "MISSING_EMAIL", outreachDate: "", outreachEmail: "", outreachSubject: ""
    },
    {
      dateAdded: "2026-09-19", company: "Stahlbau Weiss GmbH & Co. KG", country: "Germany",
      website: "stahlbau-weiss.de", industry: "Steel construction",
      description: "Стоманени конструкции и платформи за индустриални обекти.",
      products: "Платформи, стълби, парапети", processes: "Заваряване, горещо поцинковане (подизп.)",
      fitScore: 83, potentialOpportunity: "Лазерни детайли и подвъзли за платформи.",
      status: "STAGE1", stage2Needed: true, outreachEligible: false,
      decisionMakerRole: "", contactPerson: "", email: "", linkedin: "", businessPhone: "", contactSourceUrl: "",
      salesApproach: "", verifiedFacts: "", inferences: "", sources: "", notes: "",
      outreachStatus: "", outreachDate: "", outreachEmail: "", outreachSubject: ""
    },
    {
      dateAdded: "2026-09-20", company: "Metallbau Sonnleitner GmbH", country: "Austria",
      website: "sonnleitner-metallbau.at", industry: "Metal fabrication",
      description: "Метални изделия и конструкции за строителството и машиностроенето.",
      products: "Конзоли, кутии, шкафове", processes: "Рязане, огъване, заваряване",
      fitScore: 76, potentialOpportunity: "Дребносерийни огънати детайли.",
      status: "STAGE1", stage2Needed: true, outreachEligible: false,
      decisionMakerRole: "", contactPerson: "", email: "", linkedin: "", businessPhone: "", contactSourceUrl: "",
      salesApproach: "", verifiedFacts: "", inferences: "", sources: "", notes: "Под прага 80 — ниска приоритетност.",
      outreachStatus: "", outreachDate: "", outreachEmail: "", outreachSubject: ""
    },
    {
      dateAdded: "2026-09-20", company: "Lindqvist Verkstad AB", country: "Sweden",
      website: "lindqvistverkstad.se", industry: "Industrial machinery",
      description: "Машини и оборудване за дървопреработващата индустрия.",
      products: "Транспортни системи, бункери", processes: "Заваряване, монтаж",
      fitScore: 87, potentialOpportunity: "Заварени бункери и шнекови корита.",
      status: "RESEARCH_COMPLETE", stage2Needed: false, outreachEligible: true,
      decisionMakerRole: "Purchasing Manager", contactPerson: "Anna Lindqvist", email: "anna@lindqvistverkstad.se",
      linkedin: "linkedin.com/in/anna-lindqvist-lv", businessPhone: "+46 240 77 15 30", contactSourceUrl: "lindqvistverkstad.se/kontakt",
      salesApproach: "Имейл на английски: тежки заварени възли, опит със скандинавски клиенти.",
      verifiedFacts: "Доставят на 2 големи OEM; 45 служители.", inferences: "Собственият цех е тесен участък.",
      sources: "Сайт, allabolag.se", notes: "",
      outreachStatus: "DRAFT_CREATED", outreachDate: "2026-09-21", outreachEmail: "anna@lindqvistverkstad.se",
      outreachSubject: "Welded assemblies capacity for Lindqvist Verkstad"
    },
    {
      dateAdded: "2026-09-21", company: "Mécanique Précision Roussel SARL", country: "France",
      website: "mp-roussel.fr", industry: "Machine builders",
      description: "Специални машини и приспособления за аеро и жп сектора.",
      products: "Стендове, приспособления", processes: "Фрезоване, струговане, монтаж",
      fitScore: 81, potentialOpportunity: "Заварени основи и рамки за стендове.",
      status: "STAGE2_RUNNING", stage2Needed: true, outreachEligible: false,
      decisionMakerRole: "", contactPerson: "", email: "", linkedin: "", businessPhone: "", contactSourceUrl: "",
      salesApproach: "", verifiedFacts: "", inferences: "", sources: "", notes: "Stage 2 в процес.",
      outreachStatus: "", outreachDate: "", outreachEmail: "", outreachSubject: ""
    },
    {
      dateAdded: "2026-09-21", company: "Kowalski Maszyny Sp. z o.o.", country: "Poland",
      website: "kowalski-maszyny.pl", industry: "Industrial equipment manufacturers",
      description: "Оборудване за складове и интралогистика.",
      products: "Ролкови конвейери, стелажни модули", processes: "Рязане, огъване, прахова боя",
      fitScore: 79, potentialOpportunity: "Огънати детайли с покритие при пикове.",
      status: "STAGE1", stage2Needed: true, outreachEligible: false,
      decisionMakerRole: "", contactPerson: "", email: "", linkedin: "", businessPhone: "", contactSourceUrl: "",
      salesApproach: "", verifiedFacts: "", inferences: "", sources: "", notes: "",
      outreachStatus: "", outreachDate: "", outreachEmail: "", outreachSubject: ""
    },
    {
      dateAdded: "2026-09-22", company: "Bergmann Fördertechnik GmbH", country: "Germany",
      website: "bergmann-foerdertechnik.de", industry: "Industrial machinery",
      description: "Конвейерни системи и елеватори за насипни материали.",
      products: "Конвейери, елеватори, шибри", processes: "Заваряване, монтаж, боя",
      fitScore: 92, potentialOpportunity: "Серийни заварени секции и шибърни кутии.",
      status: "RESEARCH_COMPLETE", stage2Needed: false, outreachEligible: true,
      decisionMakerRole: "Geschäftsführer", contactPerson: "Markus Bergmann", email: "m.bergmann@bergmann-foerdertechnik.de",
      linkedin: "linkedin.com/in/markus-bergmann-bft", businessPhone: "+49 5921 30 88 20", contactSourceUrl: "bergmann-foerdertechnik.de/impressum",
      salesApproach: "Имейл на немски, къс: капацитет + 2 реф. проекта с конвейерни производители.",
      verifiedFacts: "Обявени 6 свободни позиции в производството.", inferences: "Недостиг на капацитет СЕГА.",
      sources: "Сайт, Indeed, LinkedIn", notes: "Силен лийд — чака outreach.",
      outreachStatus: "READY", outreachDate: "", outreachEmail: "", outreachSubject: ""
    },
    {
      dateAdded: "2026-09-22", company: "Danieli Impianti Meccanici S.p.A.", country: "Italy",
      website: "danieli-impianti.it", industry: "Heavy machinery",
      description: "Тежко машиностроене — металургично оборудване.",
      products: "Валцови стендове, рамки", processes: "Тежко заваряване, обработка",
      fitScore: 68, potentialOpportunity: "Извън нашия габарит — само дребни възли.",
      status: "STAGE1", stage2Needed: false, outreachEligible: false,
      decisionMakerRole: "", contactPerson: "", email: "", linkedin: "", businessPhone: "", contactSourceUrl: "",
      salesApproach: "", verifiedFacts: "", inferences: "", sources: "", notes: "SKIPPED: под прага (68).",
      outreachStatus: "SKIPPED", outreachDate: "", outreachEmail: "", outreachSubject: ""
    },
    {
      dateAdded: "2026-09-23", company: "Horvat Strojogradnja d.o.o.", country: "Croatia",
      website: "horvat-strojogradnja.hr", industry: "Machine builders",
      description: "Машини за преработка на пластмаси и рециклиране.",
      products: "Шредери, гранулатори", processes: "Заваряване, обработка",
      fitScore: 85, potentialOpportunity: "Корпуси и рамки за шредери.",
      status: "STAGE2_RUNNING", stage2Needed: true, outreachEligible: false,
      decisionMakerRole: "", contactPerson: "", email: "", linkedin: "", businessPhone: "", contactSourceUrl: "",
      salesApproach: "", verifiedFacts: "", inferences: "", sources: "", notes: "",
      outreachStatus: "", outreachDate: "", outreachEmail: "", outreachSubject: ""
    },
    {
      dateAdded: "2026-09-23", company: "Fischer Anlagenbau GmbH", country: "Germany",
      website: "fischer-anlagenbau.de", industry: "Industrial equipment manufacturers",
      description: "Инсталации за повърхностна обработка и галванични линии.",
      products: "Вани, рамки, платформи", processes: "Заваряване inox, монтаж",
      fitScore: 89, potentialOpportunity: "Inox вани и носещи конструкции.",
      status: "RESEARCH_COMPLETE", stage2Needed: false, outreachEligible: true,
      decisionMakerRole: "Einkaufsleiter", contactPerson: "Petra Fischer", email: "p.fischer@fischer-anlagenbau.de",
      linkedin: "linkedin.com/in/petra-fischer-fa", businessPhone: "+49 711 45 88 130", contactSourceUrl: "fischer-anlagenbau.de/kontakt",
      salesApproach: "Имейл на немски: inox компетенции + сертификати, снимки на реални възли.",
      verifiedFacts: "Работят за автомобилни бои линии; 80 служители.", inferences: "",
      sources: "Сайт, LinkedIn", notes: "Draft чака преглед.",
      outreachStatus: "NEEDS_REVIEW", outreachDate: "2026-09-23", outreachEmail: "p.fischer@fischer-anlagenbau.de",
      outreachSubject: "Edelstahl-Schweißbaugruppen — Kapazität ab Oktober"
    }
  ],

  // Пул „откриваеми" компании за mock търсенията (Stage 1 ги „намира" оттук).
  discoverPool: [
    { company: "Reinhardt Sondermaschinen GmbH", country: "Germany", website: "reinhardt-sondermaschinen.de", industry: "Industrial machinery", fitScore: 90 },
    { company: "Bianchi Automazioni S.r.l.", country: "Italy", website: "bianchi-automazioni.it", industry: "Machine builders", fitScore: 86 },
    { company: "De Groot Constructie B.V.", country: "Netherlands", website: "degroot-constructie.nl", industry: "Metal fabrication", fitScore: 84 },
    { company: "Müller & Sohn Maschinen GmbH", country: "Germany", website: "mueller-sohn-maschinen.de", industry: "Industrial equipment manufacturers", fitScore: 93 },
    { company: "Novak Industrijska Oprema d.o.o.", country: "Slovenia", website: "novak-oprema.si", industry: "Industrial machinery", fitScore: 82 },
    { company: "Jensen Maskinfabrik A/S", country: "Denmark", website: "jensen-maskinfabrik.dk", industry: "Machine builders", fitScore: 88 },
    { company: "Steiner Fördersysteme GmbH", country: "Germany", website: "steiner-foerdersysteme.de", industry: "Industrial machinery", fitScore: 87 },
    { company: "Rossi Impianti S.r.l.", country: "Italy", website: "rossi-impianti.it", industry: "Industrial equipment manufacturers", fitScore: 80 }
  ],

  activities: [
    { at: "2026-09-23 09:40", text: "Gmail Draft създаден: Fischer Anlagenbau GmbH (чака преглед)" },
    { at: "2026-09-23 09:12", text: "Stage 2 завърши: Fischer Anlagenbau GmbH — контакт потвърден" },
    { at: "2026-09-22 16:05", text: "Stage 1: добавени 3 нови компании (Германия)" },
    { at: "2026-09-21 14:30", text: "Gmail Draft създаден: Lindqvist Verkstad AB" },
    { at: "2026-09-21 11:02", text: "Stage 2: Van der Meer — НЕ е намерен потвърден имейл" },
    { at: "2026-09-20 10:15", text: "Gmail Draft създаден: Maschinenbau Krüger GmbH" }
  ],

  tasks: [
    { type: "MISSING_EMAIL", company: "Van der Meer Machinefabriek B.V.", website: "vdm-machinefabriek.nl", text: "Липсва потвърден имейл — намери ръчно или пусни повторен Stage 2.", since: "2026-09-21" },
    { type: "NEEDS_REVIEW", company: "Fischer Anlagenbau GmbH", website: "fischer-anlagenbau.de", text: "Gmail Draft чака преглед преди да остане в кутията.", since: "2026-09-23" },
    { type: "STRONG_LEAD", company: "Bergmann Fördertechnik GmbH", website: "bergmann-foerdertechnik.de", text: "Fit 92, research готов от вчера — пусни Outreach.", since: "2026-09-22" },
    { type: "LOW_FIT", company: "Danieli Impianti Meccanici S.p.A.", website: "danieli-impianti.it", text: "Fit 68 — прескочен. Потвърди или изтрий от CRM.", since: "2026-09-23" }
  ]
};
