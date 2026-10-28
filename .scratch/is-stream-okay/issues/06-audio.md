# 06: Ses sinyali ölçümü

**What to build:** İzleyici test süresince ölçülen dijital ses seviyesini ve ses sinyalinin durumunu görür.

**Blocked by:** 01 — Twitch için ilk bağımsız test; 02 — Kick için bağımsız test

**Status:** complete

- [x] Dijital ses seviyesi ve ses var, çok düşük veya sinyal algılanmadı sınıflandırması gösterilir.
- [x] Ses ölçümü yalnızca AudioContext çalışırken başlar; eşikler temsilî örneklerle belirlenir ve belgelenir.
- [x] En az 5 saniyelik örnek varsa %90 altı kapsama kısmi ölçüm olarak gösterilir; ölçülen örnek süresi ve kapsama yüzdesiyle birlikte dBFS'in yalnızca bu aralıklara ait olduğu belirtilir.
- [x] Son AudioContext durumu beklemede olsa bile yeterli örnek toplanmışsa ölçüm korunur.
- [x] Konuşma ve müzik ayrımı yapılmaz; kullanıcının fiziksel ortamında duyulabilirlik iddia edilmez.
- [x] Sessiz, düşük ve normal seviyeli kontrollü örneklerle davranış doğrulanır.

**Doğrulama:** Yerel Chromium testinde sessiz, −45 dBFS RMS ve −20 dBFS RMS WAV örnekleri sırasıyla “sinyal algılanmadı”, “çok düşük” ve “sinyal var” çıktı. Eşikler ilk sürüm için ürün sezgisidir: < −60, −60 ile < −35 ve ≥ −35 dBFS; ölçüm alt sınırı −90 dBFS'tir. AudioWorklet ile önceki canlı Twitch ölçümü −31,1 dBFS ve %99,9 kapsama, Kick ölçümü −8,4 dBFS ve %99,9 kapsama verdi. %90 veya üzeri kapsama tam; en az 5 saniye örneği olan düşük kapsama kısmi ölçümdür. Belirsiz çapraz kaynaklı sıfır örnekler hâlâ sessiz yayın diye sunulmaz. dBFS fiziksel duyulabilirlik iddiası taşımaz.
