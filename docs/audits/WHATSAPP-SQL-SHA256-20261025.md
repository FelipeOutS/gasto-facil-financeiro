# SQL candidatos — SHA-256 — 25/10/2026

Nenhum arquivo aplicado remotamente. Preflight é somente leitura. F2/F4 exigem revisão do schema real; outbox/Shopping/mês/templates permanecem inativos. Hash local identifica bytes no Windows; Git identifica blob versionado (normalização de finais de linha pode diferir). Para comparar um download do GitHub, use a coluna Git.

| Arquivo em docs/migrations-candidate | SHA-256 local | SHA-256 Git |
|---|---|---|
| public-revoke-truncate.sql | 729e1e2353bb7f47008206db31ba94113a7dff096ba7230d34dcbcd661082dc2 | cffecb0c938e12d2ca489ace2a6dbbfd7dbdf13e06d61195fa9b9ef5efe32a4e |
| public-truncate-prepost-readonly.sql | b838096812f480008f083369704f49e13017f3b3bfd51089062355ae73c89c00 | 7bc6ebd602b3812114d4cdae3a0c4dfea9735f09e7725faa331a6a44fc1c5b18 |
| whatsapp-v2-preflight-readonly.sql | f566f96dad43836e73b6ed705c4ae93fc9879a7de2de2d85b626b1c22fb990e5 | 2ba43d295ccc6862e5f63b9d0ee7e30ba22e1b91d2361c6f3fefa1f0f7e6fe9d |
| whatsapp-entry-mutations-v2.sql | b395bbf583bbd00780e8ee5e5765841cf007973a6723ac431c921bafa72b1f66 | 3da2e194e252210fcb706d8e2d027adfe1c3266474c08e7850f48217b07ece39 |
| whatsapp-undo-soft-delete.sql | f5a006077cc4d0d9a32dde3467dec07bc3e5b9f457c1278180c53de47da8471f | f5a006077cc4d0d9a32dde3467dec07bc3e5b9f457c1278180c53de47da8471f |
| gastos-soft-delete-f2.sql | 0b39af976003e99ddcb20528441644fdfb2f6ed98ee3f7fa820879ba8a61dcfb | 72ed75d5834cd765cb640760a06979ad392a2d7d925cffba2e67ac3132d2aa35 |
| gastos-delete-atomic-f4.sql | 0aeba787eb912e50d8f776d97fef355671a0e621b7d1d9d7a0518f0b753e6778 | c74c77fd70bff15b9293fd53b2b5ca2e7f6a7f138f99454bb38d71c7cc9d7886 |
| whatsapp-reply-outbox.sql | 6e8dbad609621c4041eb401b8b9f8fd30344b02cf0be032d42d3ff7a603b3885 | 1138f4a1edfc8ee040ea5f552f102fc1989e03380f8b1c3473ba0ba48deb2ab8 |
| whatsapp-agenda-templates.sql | bc27c37713175b1e7035b91192f7e0aa19bc1866f380f3dfa30e7f40f13c57db | bc27c37713175b1e7035b91192f7e0aa19bc1866f380f3dfa30e7f40f13c57db |
| whatsapp-lote-mes.sql | 425de84746128ccb2c12a7a3d0f85f0bcb729ce1d4a8dff75e399ab5d86555b0 | 9a87920d72e52a9d89d518c6f068e0831889e6717bea720cbc8fe4cb2a9e0153 |
| whatsapp-shopping-quota.sql | e1b55b488aa1fc505c692108373bc5475c596763d7aa4d12cfdde5c42d6577e1 | 04feacd6996cca46eb7965a197f02b0a87aaf2d9af96ec5640fd18b3a1885a71 |
