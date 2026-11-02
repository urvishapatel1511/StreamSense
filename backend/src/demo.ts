import type { ProcessingMessage } from './processing.js';

const fixtures = [
  ['lunar_fox', 'Hello streamer!'],
  ['cozybyte', ' hello   streamer! '],
  ['pixelpilot', 'HELLO STREAMER!'],
  ['mossycat', 'Hello streamer!'],
  ['nova_waves', 'Love your stream!'],
  ['orbit_irl', 'LOVE YOUR STREAM!'],
  ['ember_owl', 'Love your stream!'],
  ['maple_mage', 'What game is this?'],
  ['cobalt_cloud', 'What game are you playing?'],
  ['peach_pixel', 'Which game are you playing?'],
  ['river_raccoon', 'What game is this?'],
  ['puzzle_panda', 'Can you explain that dodge?'],
  ['velvet_fern', 'Can you explain that dodge?'],
  ['sunny_sprite', '  CAN YOU EXPLAIN THAT DODGE?  '],
  ['copper_comet', 'Could you explain how this puzzle works?'],
  ['little_lantern', 'Could you explain how this puzzle works?'],
  ['minty_meteor', 'Can you show the map?'],
  ['silver_snail', 'Could you open the map?'],
  ['cloudy_capybara', 'That shortcut saved a lot of time.'],
  ['blueberry_bard', 'I tried that route yesterday and got stuck.'],
  ['quiet_quokka', 'The next area looks huge.'],
  ['plum_penguin', 'Chat, I finally made it here on time.'],
  ['coral_crow', 'That was a close round!'],
  ['doodle_dragon', 'Nice play!'],
  ['teacup_tiger', 'My cat just walked across my keyboard.'],
  ['cosmic_cookie', 'I am making tea before the next round.'],
  ['saffron_sparrow', 'Did anyone catch the soundtrack title?'],
  ['starry_stoat', 'The rain outside is louder than my headphones.'],
] as const;
export const DEMO_BATCH_SIZE = fixtures.length;
export function demoBatch(startId: number, now = Date.now()): ProcessingMessage[] {
  // One intentional receipt burst. Do not fabricate a previous activity window or a live Twitch event.
  return fixtures.map(([user, text], index) => ({ id: `demo-${startId + index}`, user, text, timestamp: new Date(now).toISOString(), source: 'demo' }));
}
