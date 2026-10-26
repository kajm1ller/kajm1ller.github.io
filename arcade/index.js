/**
 * arcade/index.js — every game in Kaj Arcade, in lobby order, plus the bank.
 */

import slots from './games/slots.js';
import blackjack from './games/blackjack.js';
import poker from './games/poker.js';
import videoPoker from './games/videoPoker.js';
import baccarat from './games/baccarat.js';
import roulette from './games/roulette.js';
import hilo from './games/hilo.js';
import penguin from './games/penguin.js';
import crash from './games/crash.js';
import plinko from './games/plinko.js';
import mines from './games/mines.js';
import towers from './games/towers.js';
import dice from './games/dice.js';
import keno from './games/keno.js';
import wheel from './games/wheel.js';
import coinflip from './games/coinflip.js';
import cashier from './games/cashier.js';

export const ARCADE_GAMES = [slots, blackjack, poker, penguin, crash, plinko, mines, hilo, baccarat, roulette,
    videoPoker, towers, dice, keno, wheel, coinflip, cashier];

export { ArcadeUI } from './arcadeUI.js';
