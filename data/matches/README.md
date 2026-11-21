# Real match reports

Drop JSON arrays of match records here and the season balancer (`tools/season.mjs`) will count
them alongside self-play, weighted 3× a bot game. Each record is the compact format the game
already saves in every player's profile (`history`):

```json
[{ "season": 1, "picks": [["bastion","kaze","ember","fletch","aurelia"], ["varro","gama","hex","bolt","frost"]], "winner": 0 }]
```

When a shared backend is connected, a scheduled job can export its results into this folder.
