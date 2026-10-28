# ADR-0002: Kick yayını resmî iframe oynatıcısıyla test et

## Context

Kick'in yayın gömme rehberi `player.kick.com/<username>` adresini ve oynatmayı başlatmak için `autoplay` seçeneğini belgeler. Bu yol Kick hesabı veya yayın anahtarı gerektirmez. Hedef, yayını ziyaretçinin tarayıcısından ayrı sunucu test ortamında gözlemlemektir.

## Decision

Sunucu tarafı Chromium işçisi Kick'in resmî player iframe'ini `autoplay=true` ve `muted=true` ile açar. İşçi, oynatma ilerlemesini ve güncel görüntü ölçülerini iframe içindeki medya öğesinden gözlemler. Kare hızı, tarayıcının video-kare bildirimlerinden hesaplanır; mevcut kalite seçenekleri, oynatıcının istediği HLS ana listesinde varsa oradan alınır. Teste Twitch dışı doğrudan yayın URL'si çözümleme eklenmez.

## Consequences

- Test, Kick'in herkese açık gömme yolunu ve sunucu tarafı kaynaklarını kullanır.
- Kick iframe'inin iç yapısı değişirse medya öğesi gözlemi yeniden doğrulanmalıdır.
- Resmî bir JavaScript oynatıcı API'si bulunmadığından bu metrikler iframe içindeki video ve ağ yanıtlarının ölçümüne dayanır; Kick değişikliklerinde yeniden doğrulanmalıdır.

