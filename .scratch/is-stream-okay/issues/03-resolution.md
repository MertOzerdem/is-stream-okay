# 03: Çözünürlük ve kare hızı sonuçları

**What to build:** İzleyici yayının mevcut çözünürlüklerini ve kare hızlarını sonuç kutucuğunda görür.

**Blocked by:** 01 — Twitch için ilk bağımsız test; 02 — Kick için bağımsız test

**Status:** complete

- [x] Twitch ve Kick için erişilebilen seçenekler gösterilir ve platformlarda doğrulanır.
- [x] Twitch'te önce 1080p, yoksa özgün `chunked`/source kalite seçeneği istenir; istenen ve oynatıcının bildirdiği kalite sonuçta gösterilir.
- [x] Kick'te kalite seçme API'si belgelenmediği için ölçülen kalite yalnızca raporlanır.
- [x] Bilgi elde edilemediğinde ilgili durum gösterilir; değer uydurulmaz.
- [x] Kontrollü yayın örnekleriyle sonuçlar doğrulanır.

