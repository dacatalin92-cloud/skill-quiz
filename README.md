# Marketplace de concursuri de abilitate — platforma proprie

O platforma unde oricine se poate inregistra ca vanzator si isi poate adauga
produse doar cu o imagine, un pret si un stoc — fara sa incarce niciun
fisier digital. Clientul introduce nume si numar de telefon, alege
cantitatea, plateste, si dupa plata trebuie sa raspunda corect la o
intrebare simpla, generata automat (un calcul), ca sa primeasca imediat
"produsul digital". Acesta este, la randul lui, generat automat de
platforma: un PDF cu cate un numar unic de participare pentru fiecare
bucata cumparata (alocat aleatoriu, in limita stocului produsului) —
vanzatorul nu furnizeaza el niciun continut digital. Banii se imparte
automat intre vanzator si platforma ta, prin PayU Romania (contul de
marketplace, cu split de plata intre parti).

## ⚠️ Despre integrarea PayU — citeste inainte de a lansa

Aceasta versiune inlocuieste Stripe cu **PayU Romania** (PayU GPO Europe REST
API), la cererea ta explicita. Codul din `lib/payu.js` a fost scris pe baza
documentatiei publice PayU (developers.payu.com/europe — autentificare
OAuth2, creare comanda cu split prin `shoppingCarts`, verificare semnatura pe
notificari), dar sunt cateva lucruri importante de stiut inainte de a-l folosi
cu bani reali:

1. **Nu a putut fi testat cu apeluri reale catre serverele PayU** din mediul
   in care a fost scris (acces de retea restrictionat catre
   `secure.snd.payu.com`/`secure.payu.com`). Tot ce am putut verifica local a
   fost: sintaxa codului, pornirea serverului, migrarea bazei de date,
   fluxul complet care NU depinde de PayU (inregistrare vanzator, adaugare
   produs, simularea unei comenzi platite, alocarea numerelor, generarea
   PDF-ului/SVG-ului, evidenta admin/vanzator, lista publica de
   participanti) si verificarea semnaturii MD5 pe notificari (cu datele de
   test publice de mai jos, calculate manual, nu primite de la PayU).
   **Testeaza tu, cu contul tau real de sandbox, intregul flux de plata
   (checkout -> pagina PayU -> notificare -> deblocare produs) inainte de a
   accepta plati live.**
2. **Inscrierea vanzatorilor (boarding)**: link-ul de auto-inscriere
   ("Web Form Boarding", generat de `createBoardingLink` din `lib/payu.js`)
   functioneaza, conform documentatiei publice, doar pentru **persoane
   juridice (firme)** si e limitat la **maximum 20 de vanzatori simultan**.
   Pentru mai multi vanzatori sau pentru persoane fizice, PayU cere un flux
   separat, complet, de verificare AML/KYC prin API — **acesta NU este
   implementat aici**. Daca vrei sa deschizi platforma la mai mult de 20 de
   vanzatori sau la persoane fizice, discuta acest flux cu reprezentantul
   tau PayU inainte de a promite acces vanzatorilor.
3. **URL-ul exact al formularului de boarding** (`secure.payu.com/boarding/#/form?...`
   in codul curent) e cel aratat in documentatia publica, dar nu am putut
   confirma independent daca exista un echivalent separat pe domeniul de
   sandbox (`secure.snd.payu.com`) pentru testare. Confirma exact acest URL
   cu reprezentantul tau PayU cand primesti acces real la contul de
   marketplace.
4. Datele din `.env.example` (POS ID, client ID/secret, second key) sunt
   **date publice de test**, listate ca atare in documentatia PayU pentru
   sandbox — nu sunt ale tale si nu trebuie folosite pentru bani reali.
   Inlocuieste-le cu datele contului tau real de comerciant/marketplace PayU.

Nimic din aceasta lista nu inseamna ca integrarea e gresita — inseamna doar
ca partea care necesita o conexiune reala la PayU (pe care nu am putut-o
avea in mediul de dezvoltare) trebuie verificata de tine, o singura data,
inainte de lansare.

## ⚠️ Nota legala importanta — citeste inainte de a lansa (nu este consultanta juridica)

Ai confirmat ca numerele de participare vor fi folosite ulterior pentru o
**extragere aleatorie**, pentru un premiu suplimentar. Asta schimba complet
caracterul juridic al platformei fata de un simplu concurs de abilitate:

- **Concursul de abilitate** (intrebarea de dupa plata) ramane, prin el
  insusi, un mecanism corect: oricine raspunde corect primeste garantat
  produsul digital, indiferent de noroc.
- **Extragerea aleatorie** dintre numerele de participare este insa, prin
  definitie, un joc de noroc / o tombola: alocarea unui premiu prin sansa,
  intre participanti care au platit pentru a intra. In Romania, acest tip de
  activitate este reglementat de OUG 77/2009 privind organizarea si
  exploatarea jocurilor de noroc si necesita, de regula, autorizare
  specifica (licenta ONJN) inainte de a fi organizata public — indiferent
  ca premiul e un produs digital sau altceva. Organizarea unei tombole/loterii
  fara autorizare constituie contraventie/infractiune in Romania.
- Exista si un regim separat, mai simplu, pentru **concursurile
  promotionale** (fara plata obligatorie pentru participare, cu regulament
  oficial si, de multe ori, autentificare notariala a extragerii) — dar
  fiindca la tine participarea presupune o achizitie, e improbabil sa te
  incadrezi acolo fara o analiza atenta.

**De aceea, platforma NU executa automat extragerea si nu alege un
castigator.** Ea genereaza si tine evidenta numerelor (asta e o functie
tehnica neutra, ca un numar de comanda), dar decizia despre cum, cand si
daca se organizeaza legal o extragere ramane complet in afara codului —
este o decizie de business si de conformitate legala, a ta.

**Recomandare ferma**: inainte sa anunti public orice extragere, discuta cu
un avocat specializat in jocuri de noroc / marketing promotional din
Romania. Variante de luat in calcul, in functie de ce iti recomanda:
obtinerea unei licente ONJN daca vrei sa faci efectiv o tombola; renuntarea
la extragere si pastrarea doar a concursului de abilitate (varianta produsa
in etapele anterioare ale acestui proiect, fara nicio extragere); sau
reconfigurarea participarii ca fiind gratuita (fara achizitie obligatorie)
pentru partea de extragere, cu achizitia produsului digital separata.

Pe langa asta, ramane valabila si nota legala despre rolul de
marketplace (raportare DAC7, responsabilitatile fata de vanzatori terti,
TVA pe comision) mentionata in versiunile anterioare ale acestui document —
merita aceeasi discutie cu un contabil.

## Cum functioneaza

**Vanzatorii**:
1. Cont pe `/vanzator/inregistrare.html`, apoi conectare PayU din
   `/vanzator/dashboard.html` (obligatorie inainte ca produsele sa devina
   vizibile public).
2. Adauga produse din `/vanzator/produs-nou.html`: nume, descriere, pret pe
   bucata, **stoc** (numarul de bucati/numere disponibile) si o imagine —
   asta e tot. Nu incarca niciun fisier digital (e generat automat de
   platforma) si nu scrie intrebari (sunt generate automat, calcul simplu
   de tip "cat fac 7 + 5?").
3. Vede evidenta completa a achizitiilor proprii in
   `/vanzator/comenzi.html`: nume client, telefon, produs, cantitate,
   numerele atribuite, status.

**Clientii**:
1. Vad toate produsele active pe pagina principala, cu stocul ramas afisat
   ("12 din 50 disponibile" / "Stoc epuizat").
2. Introduc nume si numar de telefon, aleg cantitatea, platesc prin PayU.
3. Dupa plata, primesc imediat imaginile cu numerele de participare
   (cate una pentru fiecare bucata cumparata) si raspund la intrebarea
   generata automat. La raspuns gresit mai au incercari (`MAX_ATTEMPTS`),
   cu o intrebare noua de fiecare data. La raspuns corect, primesc un link
   de descarcare pentru un PDF generat pe loc, cu cate o pagina pentru
   fiecare numar al lor.
4. Oricine poate vedea lista publica de participanti pentru un produs
   (`/participanti.html?produs=ID`) — doar prenume si numar, fara alte date.

**Stocul si numerele**: fiecare produs are un stoc fix, stabilit de
vanzator. Numerele de participare sunt alocate **aleatoriu** (nu in ordinea
achizitiei) dintre numerele neutilizate inca, in limita acelui stoc, o
singura data per comanda, imediat ce plata e confirmata. Cand stocul se
epuizeaza, produsul afiseaza "Stoc epuizat" si nu mai poate fi cumparat.

**Admin (tu)**: `/admin/login.html`, cu parola din `ADMIN_PASSWORD` — acces
complet la toate comenzile, de la toti vanzatorii, cu toate datele
(inclusiv telefon si nume complet).

## Configurare rapida (local)

1. Node.js 18+ (foloseste `fetch` global din Node — nu e nevoie de o
   biblioteca separata pentru cereri HTTP catre PayU).
2. `npm install`
3. Copiaza `.env.example` in `.env` si completeaza:
   - `PAYU_POS_ID`, `PAYU_CLIENT_ID`, `PAYU_CLIENT_SECRET`, `PAYU_SECOND_KEY`
     — din contul tau de comerciant/marketplace PayU (vezi nota din
     `.env.example`: valorile implicite sunt date publice de test PayU,
     nu ale tale).
   - `PAYU_MARKETPLACE_PARTNER_ID` — daca ai unul distinct de POS ID.
   - `PAYU_SANDBOX` — `true` pentru testare, `false` pentru bani reali.
   - `BASE_URL` — adresa publica a site-ului (PayU trimite notificari aici;
     trebuie sa fie accesibila din internet, nu doar `localhost` — foloseste
     un tunel gen ngrok/cloudflared pentru testare locala).
   - `PLATFORM_FEE_PERCENT` — comisionul tau, in procente.
   - `SESSION_SECRET` — un sir lung si aleatoriu.
   - `ADMIN_PASSWORD` — parola ta de acces la `/admin/login.html`.
4. `npm start`
5. Notificarile PayU ajung automat pe `POST ${BASE_URL}/payu/notificare`
   (setat automat de server la crearea fiecarei comenzi) — nu mai e nevoie
   de o unealta separata gen `stripe listen`, doar ca `BASE_URL` sa fie
   accesibila public. Vezi si sectiunea "Despre integrarea PayU" de mai sus
   pentru ce anume nu a putut fi testat impotriva serverelor reale PayU.

## Structura tehnica, pe scurt

- `sellers` — conturile vanzatorilor.
- `products` — produsele, cu `stock_total` (stocul fix stabilit la creare)
  si doar `image_path` ca fisier incarcat (nu mai exista fisier digital
  de produs in baza de date).
- `tickets` — numerele alocate: `(product_id, order_id, number)`, unic per
  produs. Numerele nu se realoca niciodata, chiar daca o comanda ramane
  neplatita/anulata.
- `orders` — comenzile, cu `buyer_name`, `buyer_phone`, `quantity`, si
  `current_question` (intrebarea generata automat, stocata temporar ca
  JSON, regenerata la fiecare incercare gresita).

Intrebarile NU mai sunt stocate intr-o banca — sunt generate de
`lib/questionGenerator.js` la nevoie. Fisierul digital livrat clientului
NU mai e incarcat de vanzator — e generat pe loc, la fiecare descarcare,
de `lib/ticketPdf.js` (folosind pachetul `pdfkit`), pe baza numerelor deja
alocate comenzii. Asta inseamna ca vanzatorul incarca DOAR o imagine de
produs (validata sa fie de tip imagine) — nu mai exista nicio lista de
extensii periculoase de gestionat, fiindca nu se mai accepta fisiere
arbitrare de la vanzatori.

Fiecare numar de bilet primeste un design diferit (o combinatie de culoare
si model decorativ, alese determinist din `lib/ticketThemes.js`) — acelasi
numar arata mereu la fel, atat in imaginea afisata pe pagina de raspuns
(`lib/ticketImage.js`, SVG) cat si in PDF-ul descarcat (`lib/ticketPdf.js`).
Poti adauga usor mai multe combinatii de culori/modele editand
`PALETTES`/`MOTIFS` din `lib/ticketThemes.js`.

## Deploy in productie

La fel ca pentru un site Node/Express obisnuit. De verificat:

- Disk persistent pentru `orders.sqlite` si `uploads/`.
- `SESSION_SECRET` si `ADMIN_PASSWORD` raman constante dupa lansare.
- La volum mare, ia in calcul mutarea `uploads/` intr-un storage extern.
- Alocarea numerelor de bilet e facuta intr-o tranzactie DB simpla, cu
  numere alese aleatoriu dintre cele neutilizate — la volum foarte mare
  (stocuri de zeci de mii de bucati) sau concurenta ridicata (multe
  achizitii simultane pe ultimele bucati din stoc), merita testat/intarit
  acest punct inainte de o lansare cu trafic mare.

## Extinderi posibile (nu sunt incluse acum)

- Un instrument separat, clar marcat, pentru a rula efectiv o extragere
  (dupa ce clarifici partea legala) — momentan platforma doar genereaza si
  afiseaza numerele.
- Panou de administrare pentru a dezactiva manual produse/vanzatori.
- Emailuri/SMS-uri automate catre client (confirmare, link de rezerva).
- Rambursare automata cand un client epuizeaza incercarile la intrebare.
- Export CSV al evidentei achizitiilor.

Spune-mi daca vrei sa adaug oricare dintre acestea.
