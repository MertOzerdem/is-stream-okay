# ADR-0003: Takılmaları oynatıcı olaylarından ölç

## Context

Twitch Embed API'si `bufferSize` değerini verir, ancak takılma eşiği veya başlangıç olayı tanımlamaz. Kick'in herkese açık iframe rehberi de oynatma olayı API'si sunmaz. HTML medya öğesinin `waiting` ve `playing` olayları, oynatmanın veri beklerken durduğu ve yeniden başladığı sınırları verir.

## Decision

Sunucu tarafı Chromium, Twitch ve Kick'in resmî iframe'leri içindeki video öğesini izler. İlk `playing` olayı gözlem başlangıcıdır. Sonraki `waiting` ve `playing` olayları bir takılma ve süresini oluşturur. Test bittiğinde sürmekte olan aralık gözlem sınırına kadar sayılır. Zaman damgaları aynı iframe'in monotonik saatinde karşılaştırılır. Kontrollü kesintilerdeki en büyük fark 306 ms olduğundan ekranda ±0,5 saniye hata payı gösterilir.

## Consequences

- Her iki platformda aynı davranış ölçülür; `bufferSize` tek başına takılma kanıtı sayılmaz.
- Twitch veya Kick video öğesinin iframe içindeki yapısını değiştirirse ölçüm erişilemez olabilir. Böyle bir durumda değer uydurulmaz; ölçüm verisi alınamadığı gösterilir.
- Hata payı kontrollü Chromium olay testi ve canlı oynatıcı kesintilerinin bağımsız video zamanı ölçümüyle karşılaştırılmasıyla belirlenmiştir; Chromium veya oynatıcı entegrasyonu değiştiğinde tekrar ölçülmelidir.

