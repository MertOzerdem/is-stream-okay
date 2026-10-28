# ADR-0001: Twitch yayını sunucu tarafı tarayıcıda test et

## Context

Ürün, yayını ziyaretçinin bilgisayarından ayrı bir ortamda ölçmelidir. Twitch, izin verilen gömülü oynatıcı üzerinden oynatma durumunu ve bazı teknik istatistikleri sunar. Oynatıcıyı ziyaretçinin web sayfasına koymak testi yine ziyaretçinin tarayıcısında çalıştırır. Yayın adresini doğrudan çözümlemek ise Twitch'in belgelenmiş oynatıcı arayüzünün dışına çıkar.

## Decision

Twitch'in resmî Embed API'si, test hizmetinin yönettiği sunucu tarafı Chromium oturumunda çalıştırılır. Son kullanıcı yalnızca test bağlantısını ve sonucu görür. Genel host adı embed'in `parent` parametresine verilir.

## Consequences

- Test, ziyaretçinin cihazından ve ev bağlantısından bağımsız bir sunucu ortamında çalışır.
- Her test yaklaşık 30 saniye Chromium kaynağı tüketir; eşzamanlı testler sınırlandırılmalıdır.
- Üretim hostu HTTPS kullanmalı ve Twitch embed kurallarına uymalıdır.
- Yalnızca resmî oynatıcının sağladığı ve test ortamında ölçülebilen değerler raporlanabilir. Sonraki biletler her ölçümü ayrıca doğrulamalıdır.

