# Farmclaws part 4d — the town life playbook

The browser check for the part 4d spec §10, short. Load the probe after every navigation (see SKILL.md); each check starts from `?new`. Drive time with `__qa.tick(n)`; the clock is `__qa.state().time.minuteOfDay`, a walker's spot is `__qa.state().npcs.sol.place` (townsfolk: `.townsfolk.kid.place`). Go to town with `F.withPlayer(__qa.state(), { tx: 7, tz: 8 }, 0, 'town')`.

1. **First morning:** at 6:00 am Sol's `place` is `out` at the well (21,13) and Marigold's is `indoors`; take job 1 from Sol.
2. **8:00 am:** E on the general store door (6,6) from (6,7) and `KeyB` both toast "Sorry, we are closed! Open again at 9:00 am."; after `__qa.tick(60)` the door opens the seed shop, and the signs read OPEN (screenshot).
3. **Lunch:** tick to 12:30 pm; Cosmo and Barnaby come through the east gate (39,16) and stand with the other five in the square (screenshot).
4. **The town:** the townsfolk walk their loops (8:00 am to 7:00 pm; rain brings out only the jogger and courier), the props and brand posters stand, and the kid by SLOPMART (29,8) chats with no buttons.
5. **After 7:00 pm:** the town is empty (every `place` `indoors`) and SLOPMART's neon is lit (screenshot); at the booth door (29,7) E opens DEALZ, give gold first, buy three boxes, and the fourth is refused.
6. **The Neighbours:** Cosmo and Barnaby stand beside their fields, Cosmo's door (5,4) opens onto the field through the gap at (5,5), and five chickens peck in the run (screenshot).
