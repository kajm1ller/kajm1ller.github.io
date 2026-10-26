/**
 * js/game/barTalk.js
 *
 * What people say when you talk to them at the downtown bars at night (game.html
 * talkToNearbyPedestrian): 300 lines across how drunk they are, failing their classes, crying
 * about boys, looking for the bathroom, bumming a cigarette, the music, the drinks, losing their
 * friends and their phone, food, and three-in-the-morning philosophy.
 */

const DRUNK = [
    "I'm not drunk, I'm just... horizontally gifted.",
    "How many have I had? Like four. Or nine. One of those.",
    "Is the floor moving or is that just me?",
    "I told myself I'd only have one tonight. That was five drinks ago.",
    "Everything is spinning but in like a fun way.",
    "I'm so drunk I just tried to pay with my student ID.",
    "Can you hold my drink? Actually no, I need it to stand up.",
    "I've had exactly the right amount. Which is too much.",
    "My legs are not cooperating with my brain right now.",
    "I'm at the stage where I love everybody. I love you, man.",
    "Do I look drunk? Don't answer that.",
    "I think I'm seeing two of you and they're both judging me.",
    "Bro I've been drinking since the pregame at four.",
    "I'm so faded I forgot what bar this is.",
    "Is this Howard's? It feels like Howard's. Everything feels like Howard's.",
    "I shotgunned three beers in the parking lot. I regret nothing. Yet.",
    "My friend bet me I couldn't finish a fishbowl. I finished two.",
    "I'm not slurring, I'm speaking in cursive.",
    "One more shot and I'm calling it. Okay two more.",
    "Tomorrow me is gonna hate tonight me so much.",
    "If I sit down I'm never getting back up.",
    "I'm drunk enough to dance but not drunk enough to sing. Give me twenty minutes.",
    "Why is my drink empty? Who drank my drink? Oh. Me.",
    "I keep closing one eye so there's only one of everything.",
    "I'm basically sober. Watch, I can touch my nose. ...Where'd my nose go?",
    "The room is doing that tilty thing again.",
    "I had a water earlier, so I'm basically hydrated for the night.",
    "I just hugged the bouncer. He did not hug me back.",
    "My blood is like forty percent vodka right now.",
    "I've lost the ability to count my drinks, which is a sign I should have another.",
    "I don't even remember walking here. Did I walk here?",
    "Jäger bombs were a mistake. A beautiful mistake.",
    "My face is numb. Can you see my face? Is it still there?",
    "If I throw up, it's the tacos, not the tequila.",
    "Everyone keeps telling me to drink water like I'm some kind of plant.",
    "I'm so drunk I texted my mom happy birthday. It's not her birthday.",
    "This is my third bar tonight and my second favorite.",
    "I've reached the 'I can totally drive' stage. I'm not going to. I'm just saying.",
    "Whiskey makes me feel like a cowboy. Yeehaw. Sorry.",
    "Stop letting me buy shots for strangers.",
    "I'm not drunk, I'm celebrating. What are we celebrating? Thursday.",
    "I'm one drink away from telling everyone I love them.",
    "My tolerance was way higher freshman year. I'm getting old. I'm twenty-two.",
    "Pretty sure I just ordered a drink from a guy who doesn't work here.",
    "If you see me dancing on a table, no you didn't."
];

const CLASSES = [
    "I have an exam at eight a.m. and I'm out here. Great decision-making.",
    "I'm failing stats so hard. Like statistically, it's not looking good.",
    "My professor emailed me asking if I'm still enrolled. Rude. Accurate, but rude.",
    "I haven't been to my Tuesday class since September.",
    "I'm one more missed quiz away from losing my scholarship.",
    "My GPA is lower than my blood alcohol content right now.",
    "I'm changing my major again. Fourth time. Undeclared is a lifestyle.",
    "I have a twelve page paper due Monday and I've written my name.",
    "Bio lab is trying to kill me. I'm not even kidding.",
    "My advisor looked at my transcript and just sighed.",
    "Why did I sign up for organic chemistry? Who let me do that?",
    "I'm drinking to forget that midterm. It's working.",
    "I got a forty-two on my econ exam and the curve made it a forty-four.",
    "I'm gonna drop out and open a bar. This bar, specifically.",
    "Finals week starts Monday so this is my goodbye tour.",
    "My group project partners haven't answered a single text. I'm doing it alone again.",
    "I took a nap in the library and woke up in the dark.",
    "Calculus is a scam made up by Big Math.",
    "I emailed my professor at two a.m. with three typos. I'm never going back.",
    "My mom thinks I'm studying right now. Hi Mom.",
    "I've been on academic probation so long they should give me tenure.",
    "I accidentally went to the wrong final last semester and took it anyway. Got a B.",
    "Does anyone know what 'syllabus' means? Asking for a friend.",
    "My philosophy class made me question everything, including going to philosophy class.",
    "I'm a senior and I still don't know where Olscamp is.",
    "I wrote my whole essay on the wrong book. The wrong book.",
    "My TA is here and I'm trying very hard not to make eye contact.",
    "I'm gonna be in college for seven years at this rate. Van Wilder style.",
    "I failed a class that was literally called 'Intro to Success.'",
    "I set fourteen alarms for my exam and slept through all of them.",
    "I have three exams on the same day. Three. I'm going to die here tonight.",
    "My lab partner did the whole lab and I just held the beaker. Teamwork.",
    "I'm switching to communications. It's the major for people who like talking. Like me. Right now.",
    "I put 'see attached' on my assignment and forgot to attach it.",
    "If I fail this class I have to retake it with the same professor. He knows my face.",
    "I'm paying thousands of dollars to sleep through lectures.",
    "My final project is due at midnight. It's eleven thirty. I'm at a bar.",
    "I'm graduating in May. Hopefully. Possibly. Probably not.",
    "My roommate is a 4.0 and I'm a 2.1 and we live off the same ramen.",
    "I have a quiz tomorrow on a book I've never opened. I'm gonna wing it."
];

const BOYS = [
    "He hasn't texted me back in three days. Three days! Do you think he's dead?",
    "I saw my ex walk in with some girl and I'm totally fine. I'm totally fine.",
    "He said he wasn't looking for anything serious and then got a girlfriend a week later.",
    "Why do I always like the ones who don't like me back?",
    "He left me on read and then liked my story. What does that MEAN?",
    "I'm not crying, my mascara is just... leaving.",
    "We were talking for two months and he says we were 'never official.'",
    "Don't let me text him. I'm serious. Take my phone if I try.",
    "He watched my story at two a.m. That means something, right? Right?",
    "I deleted his number but I still know it by heart. That's the worst part.",
    "He's at Uptown with his frat brothers and I am NOT going over there. Unless you come with me.",
    "Boys are so stupid. Okay that one's kind of cute though.",
    "He called me by his ex's name. On our anniversary.",
    "I made him a playlist and he never listened to it. Forty-two songs!",
    "Is it bad that I still have his hoodie? It smells like him. Is that weird?",
    "He said 'you're like a sister to me.' I want to scream.",
    "My best friend is dating my ex and I'm supposed to be happy about it.",
    "He ghosted me and then showed up in my lecture. I had to sit there for an hour.",
    "Every guy in Bowling Green is either taken, a frat guy, or my cousin.",
    "He told me he'd call and that was two weeks ago. Maybe his phone broke. For two weeks.",
    "I cried in the bathroom for ten minutes and then fixed my makeup. Iconic.",
    "We matched on Tinder and he unmatched me after one message. One!",
    "He said he needed space so I gave him the whole city.",
    "I keep checking if he's online. He's online. He's not texting me. He's online!",
    "Can you look over there and tell me if he's looking at me? Don't make it obvious!",
    "He bought another girl a drink right in front of me. While I was holding his jacket.",
    "I'm done with men. Hi, are you single?",
    "My ex just texted 'u up.' I am up. I'm not answering. I'm answering.",
    "He broke up with me over Snapchat. Over Snapchat!",
    "He said he liked me but he 'liked his freedom more.' What freedom? He lives with his mom.",
    "I want someone to look at me the way he looks at his Xbox.",
    "We dated for a year and he still spells my name wrong.",
    "I'm gonna go talk to him. No I'm not. Yes I am. Hold my drink.",
    "He said I was 'too much.' Too much what? Too much awesome?",
    "I just found out he's been talking to three other girls. Three!",
    "I can't believe I spent my whole birthday waiting for him to show up.",
    "My heart hurts and my feet hurt and I'm out of money.",
    "He's the love of my life, we met forty minutes ago.",
    "Why do they always come back when you finally stop caring?",
    "He says I'm 'a lot' but honestly he's not enough.",
    "I'm going to marry the bartender. He gave me extra lime.",
    "I wrote him a letter. Like on paper. And he said 'lol.'",
    "Everybody keeps saying 'you'll find someone.' When? I'm right here!",
    "He wore the shirt I bought him on a date with another girl.",
    "Love is fake. Let's get nachos."
];

const BATHROOM = [
    "Where's the bathroom? It's an emergency. A real one.",
    "Do you know where the bathroom is? I've been looking for like twenty minutes.",
    "Is the bathroom upstairs or downstairs? I've been to both and found neither.",
    "The line for the girls' bathroom is insane. Is the guys' room empty?",
    "I broke the seal. I'm gonna be in that bathroom every ten minutes now.",
    "Somebody's been in the bathroom for half an hour. I think they live there now.",
    "Is there toilet paper in there? Be honest with me.",
    "There's a guy crying in the bathroom. Should I check on him?",
    "Don't go in the second stall. Just trust me.",
    "Bathroom's back past the pool table, I think. Or that's the kitchen. One of those.",
    "I've been holding it since the last bar. Where is it?",
    "The bathroom door doesn't lock so I'm just gonna need you to stand guard.",
    "Why are bar bathrooms always so far away and so terrible?",
    "I got lost looking for the bathroom and ended up in the storage room.",
    "Can you watch my drink? I gotta pee so bad.",
    "I met my new best friend in the bathroom line. Her name is Jess or Tess. Love her.",
    "The bathroom mirror here makes everybody look amazing. That's why I live in there.",
    "Is it 'Guys' or 'Gents'? Why can't they just put a picture?",
    "I just walked into the wrong bathroom. Nobody said anything, so.",
    "If I'm not back in five minutes, I fell asleep on the toilet. Come get me."
];

const CIGARETTE = [
    "Hey, do you have a cigarette I could bum? I'll pay you back. In spirit.",
    "You got a lighter? Or a cigarette? Or both? Both would be great.",
    "I quit smoking. I only smoke when I drink. I drink every night.",
    "Can I bum a smoke? I left mine in my friend's car and my friend left.",
    "I'll give you a dollar for a cigarette. I don't have a dollar. I'll owe you a dollar.",
    "Wanna go outside for a smoke? I need air. Smoky air.",
    "Do you vape? Can I hit it? Just once. Okay twice.",
    "I'm social smoking. It's like regular smoking but with friends.",
    "Does anybody have a Juul? Mine died and so did my will to live.",
    "Someone stole my pack off the table. Who steals cigarettes at a bar? Everyone, apparently.",
    "If you're going out to smoke, I'm coming with you.",
    "Got a light? I've got the cigarette, I just don't have fire.",
    "I only smoke menthols. Do you have menthols? I'll take anything actually.",
    "My mom would kill me if she saw me smoking. Don't tell my mom.",
    "Can I bum a cigarette? I'll be your best friend for like ten minutes.",
    "I'm gonna quit tomorrow. For real this time. Can I get one now?",
    "The patio's the only place you can breathe in here. Ironically.",
    "Is the patio open? I need a cigarette and some fresh air at the same time.",
    "Bro, you smoke? No? Cool, cool. Me neither. Do you know anyone who does?",
    "I'm trading a cigarette for a sip of that. Fair deal.",
    "Somebody said there's a guy outside selling loosies for fifty cents.",
    "I've bummed so many smokes tonight I owe people a whole carton.",
    "Lighter's out of fluid. Does anyone have a match? Like a real match?",
    "I'll smoke one with you but just to keep you company.",
    "I don't even smoke, I just like holding them. It makes me feel mysterious."
];

const MUSIC = [
    "THIS IS MY SONG! Oh wait, it's not. Close enough!",
    "Who keeps requesting Mr. Brightside? Oh wait, it was me.",
    "The DJ is actually fire tonight.",
    "Come dance with me! I'm terrible but I'm confident.",
    "I've danced so much my shoes are filing a complaint.",
    "If they play 'Don't Stop Believin'' one more time, I'm leaving. I'm singing along, but I'm leaving.",
    "The band at Howard's tonight is so loud I can feel it in my teeth.",
    "Can you ask the DJ to play something from 2009? Anything. I'm begging.",
    "I requested Wagon Wheel. I'm not sorry.",
    "I'm not a good dancer but I'm a committed dancer.",
    "Whoever's DJing should be paid triple. Or arrested. One of those.",
    "I sang karaoke earlier and three people walked out. Two came back though.",
    "The dance floor is sticky. Like really sticky. I lost a shoe out there.",
    "They played my breakup song and now I'm emotional.",
    "I came here for the music and stayed for the cheap pitchers.",
    "I've been on the dance floor for two hours straight. I'm basically an athlete.",
    "That song was on my high school prom playlist. I'm having flashbacks.",
    "Is that a live band or just a really loud jukebox?",
    "I paid the jukebox five bucks and nobody's played my songs yet.",
    "They need to turn the music up. Wait, what? I can't hear you. Exactly.",
    "Dance-off. You and me. Right now.",
    "I know every word to this and I'm going to prove it.",
    "Somebody put on Cotton Eye Joe and the whole bar went feral.",
    "I can't dance but I can jump up and down, which is basically the same thing.",
    "Shut up, this is the best part of the song!"
];

const DRINKS = [
    "Pitchers are half off till midnight. That's basically free.",
    "What are you drinking? I'm drinking whatever's cheapest.",
    "I ordered a fishbowl for one. The bartender looked worried.",
    "Can you buy me a drink? I'll buy you one next time. There won't be a next time.",
    "Two-dollar wells. Two dollars! We're basically making money.",
    "The bartender's been ignoring me for ten minutes. Do I look invisible?",
    "I asked for a vodka cran and got something blue. I'm drinking it anyway.",
    "Wanna split a pitcher? I'll get the next one. Probably.",
    "This beer tastes like water and regret.",
    "I tipped the bartender ten bucks so now we're best friends.",
    "Who ordered tequila? Who ORDERED tequila? We all have to take it now.",
    "My card got declined. Can you spot me like six bucks?",
    "I'm only drinking light beer because I'm on a diet.",
    "Do they make a drink that cures sadness? I'll take a double.",
    "The bartender just made me a shot called 'The Regret.' It's accurate.",
    "I spent my whole paycheck tonight. Worth it? Ask me in the morning.",
    "Let's do a shot! What kind? Doesn't matter! A shot!",
    "Whoever invented the jello shot deserves a Nobel Prize.",
    "I've been nursing this beer for an hour. It's warm now. I'm still drinking it.",
    "Bud Light, Busch Light, or Natty Light. The three food groups.",
    "I asked for a water and they charged me two dollars. Highway robbery.",
    "They cut me off at the last place, so I came here. Fresh start.",
    "Is it a red Solo cup night or a glass night? Glass. Fancy.",
    "This vodka tastes like it was made in a bathtub.",
    "I'm starting a tab. I'm not going to close it. I'm going to forget about it."
];

const FRIENDS = [
    "Have you seen my friends? There's like five of them. They're all wearing black.",
    "My phone's at two percent. If I die tonight, tell my mom I love her.",
    "I lost my group like an hour ago. I've just been vibing alone.",
    "My Uber driver cancelled. Three times. The universe doesn't want me to leave.",
    "My friend just went home with someone and left me here. Classic Jess.",
    "Does anybody have an iPhone charger? I'll give you my firstborn.",
    "I came here with six people and I'm leaving with zero.",
    "My roommate locked herself out and I have the keys and I'm here. Oops.",
    "Can I use your phone? Mine's dead and I need to find my friend Kyle. I don't know his number.",
    "If you see a guy in a backwards hat yelling 'BROOOO,' that's my friend. Send him over.",
    "My ride home is drunker than me. I think I'm walking.",
    "We're going to the next bar, you coming? Which one? All of them.",
    "My friend just threw up in a planter outside. He's doing great though.",
    "My group chat has two hundred unread messages. I'm scared to open it.",
    "I promised I'd be the designated driver and then I forgot.",
    "We're doing a bar crawl but honestly we've just been crawling.",
    "Have you seen a girl crying in a pink top? That's my roommate. Or it's me later.",
    "My friend's trying to get us into Uptown with a fake ID that says he's from Hawaii.",
    "I'm the mom friend tonight. Drink some water. Did you eat? Where's your jacket?",
    "Somebody took my jacket from the coat pile. It was not a nice jacket. Why?",
    "I've been trying to leave for forty-five minutes. Every time I say goodbye someone buys a round.",
    "My friend is passed out in the booth. We're letting him sleep. He's earned it.",
    "My friends just started fighting about pizza toppings. Pineapple's fine, guys.",
    "My bestie and I matched our outfits and now everyone thinks we're a band.",
    "Where's everyone going after this? I'm following someone. Anyone."
];

const FOOD = [
    "I would kill for some Myles' Pizza right now.",
    "Is the taco truck still out there? Please say yes.",
    "I'm getting Taco Bell after this. A lot of Taco Bell.",
    "Do they have fries here? I need something to soak up all this beer.",
    "I'm so hungry I could eat a whole pizza. And I'm going to.",
    "Late night breakfast at the diner after this. Who's in?",
    "I have half a burrito in my purse from earlier. Want some?",
    "I just ordered wings and I have no money to pay for them.",
    "Mozzarella sticks are the only thing keeping me alive tonight.",
    "If someone doesn't get me cheese fries, I'm going to cry. Again."
];

const RANDOM = [
    "Do you ever think we're all just NPCs in somebody's video game?",
    "You have really nice eyes. Both of them. Even the third one.",
    "I love this town. Bowling Green is the best town. There's nothing here and I love it.",
    "I'm gonna be famous someday. You'll see. You'll all see.",
    "I'm getting a tattoo tomorrow. Of what? Of this moment.",
    "I just figured out the meaning of life and now I forgot it.",
    "Do you think the bouncer has feelings? He looks so sad.",
    "I've lived here three years and I still get lost on Wooster.",
    "You remind me of someone. My cousin? A celebrity? My cousin's a celebrity? No.",
    "I'm starting a podcast. It's just me talking about my ex.",
    "Is it just me or is everyone in here really good-looking tonight?",
    "If you could be any animal, what would you be? I'd be a raccoon. Free trash.",
    "I'm gonna go home and write a novel. Starting at three a.m.",
    "Who's Kaj? Everyone keeps talking about some guy named Kaj.",
    "Go Falcons! Wait, is there a game? There's always a game.",
    "I've been here so many times the bartender knows my order and my middle name.",
    "Let's make a pact to be best friends forever. What's your name again?",
    "The stars look so pretty tonight. Wait, that's the streetlight.",
    "My horoscope said today would be life-changing. So far I lost a shoe.",
    "Have you ever seen a ghost? I think this building is haunted. Or I'm drunk.",
    "I'm gonna buy a boat. I don't know how to sail. Details.",
    "You know what this town needs? A second Taco Bell.",
    "My dad's gonna see my bank statement and call me tomorrow, I just know it.",
    "Do you believe in fate? Because I think fate brought me to this bar. Also my friend Tyler.",
    "Remember when we were kids and wanted to grow up? Big mistake.",
    "What if pizza was actually a pie and pie was actually a cake? Think about it.",
    "I'm adopting a cat tomorrow. I'm naming it Pitcher.",
    "Have you ever been so happy you cried? I'm about to. Also so sad. Both.",
    "Life's too short to drink bad beer. That's why I drink cheap beer. It's different.",
    "I think the cops are outside. Act natural. I said NATURAL.",
    "I'm going to remember this night forever. Or not at all. One of the two.",
    "One day we'll all look back on this and laugh. Probably at me.",
    "Do you think aliens go to bars? I think that guy's an alien.",
    "Honestly, I've never felt more alive than right now, sweating in this bar.",
    "You seem cool. Wanna start a band? I can't play anything but I can name it.",
    "It's not even midnight and I've already made three new enemies.",
    "I keep telling people I'm from Toledo so they don't ask follow-up questions.",
    "I'm a Gemini, so like, I'm two people tonight.",
    "There's a guy outside dressed as a hot dog. Nobody knows why.",
    "Okay but have you tried the frozen custard place? Life-changing."
];

// ------------------------------------------------------------------------------------------------
// What people say about the state YOU'RE in (anywhere, day or night)
// ------------------------------------------------------------------------------------------------
/** You've had a few: they notice, and play along. */
const TIPSY_REACT = [
    "Ha, somebody's feeling good tonight.",
    "You're a little wobbly there, buddy.",
    "Okay, you're definitely a few drinks in.",
    "Ooh, your cheeks are all red. How many have you had?",
    "You're fun tonight! Are you always this fun?",
    "Easy there, champ. Pace yourself.",
    "Somebody pregamed, huh?",
    "You smell like a brewery. I respect it.",
    "You're talking really loud. I like it, but you're talking really loud.",
    "Hey, how about a water between rounds? Just a thought.",
    "You good? You look like you're having a great night.",
    "You're swaying a little. It's cute. Kind of.",
    "Okay, no more shots for you for like twenty minutes.",
    "Your eyes are doing a little wander thing. You good?",
    "Somebody's gonna feel this tomorrow."
];
/** Hammered: they're worried about you. */
const WASTED_REACT = [
    "Whoa, whoa, are you okay? You need some water?",
    "Hey, sit down for a second. I'll get you a water.",
    "Are you okay? You look like you're about to fall over.",
    "Dude, you need water. Like, right now. Bartender! Water!",
    "Do you need me to call someone for you? A friend? An Uber?",
    "You're really, really drunk. Have you eaten anything today?",
    "Hey, look at me. How many fingers am I holding up? ...Okay, water. Now.",
    "I think you should go home, man. Where do you live? Can you walk?",
    "Are you gonna throw up? Please tell me if you're gonna throw up.",
    "Here, drink this. It's water. Just water. Trust me.",
    "You can barely stand up. Is anyone here with you?",
    "Babe, you need to sit down and drink some water. I'm serious.",
    "I'm not letting you drive. Give me your keys. I don't care whose car it is.",
    "You okay? You've been staring at the wall for like five minutes.",
    "Oh no, you're the drunkest person here. That's saying something.",
    "Let's get you some fresh air. Come on, outside. Slowly.",
    "Do you know where you are right now? Okay. Water. Then we'll talk.",
    "You're scaring me a little. Do you need help?",
    "Hey, hey, eyes open. Stay with me. You need water and a pizza.",
    "Please don't have another drink. Please. I'm begging you."
];
/** High: worried in a different way. */
const HIGH_REACT = [
    "Are you okay? Your pupils are like, huge.",
    "Dude, are you tripping right now? You need some water?",
    "You look really, really high. Do you want to sit down?",
    "Are you okay? You keep staring at your hands.",
    "Hey, you're sweating a lot. Drink some water, okay?",
    "You're talking super fast. Like, super fast. Breathe.",
    "Whatever you took, you took too much of it. Sit down.",
    "You good? You've been giggling at nothing for a while.",
    "Your eyes are so red. You need eye drops and a water.",
    "Hey, are you having a good time or a bad time? Your face is doing both.",
    "Do you need me to stay with you? You don't look okay.",
    "Man, you look out of it. Have some water and chill for a minute.",
    "You're shaking a little. Are you okay? Should I get someone?",
    "I think you need to go somewhere quiet. It's a lot in here.",
    "You keep asking me what time it is. It's still the same time.",
    "Whoa, your jaw is going crazy. Drink some water, please.",
    "Are you seeing something I'm not seeing? Because you keep pointing.",
    "You're freaking me out a little. Do you need water? Food? A hug?",
    "Okay, deep breaths. In and out. You're gonna be fine. Water?",
    "Bro, you should not be here like this. Let me get you some water."
];
/** Overdosing: get help. */
const OD_REACT = [
    "Oh my god, are you okay?! Someone call 911!",
    "You're turning grey. Sit down. I'm getting help!",
    "Hey! HEY! Stay awake! Somebody call an ambulance!",
    "You need a doctor. Like right now. I'm calling someone."
];
export const REACT_LINES = { TIPSY_REACT, WASTED_REACT, HIGH_REACT, OD_REACT };

/**
 * What someone says about the state you're in, or null when you look fine (or only a bit merry
 * and they'd rather talk about themselves). `intox` = DrugEffects.intoxication(); `roll` 0..1.
 */
export function reactionLine(intox, seed, count, roll = Math.random()) {
    if (!intox) return null;
    const pick = (list) => list[((seed >>> 0) + count * 7) % list.length];
    if (intox.od > 0.05) return pick(OD_REACT);
    if (intox.high >= 0.6 && intox.high >= intox.drunk) return pick(HIGH_REACT);
    if (intox.drunk >= 0.85) return pick(WASTED_REACT);
    if (intox.high >= 0.6) return pick(HIGH_REACT);
    // Getting there: most of the time they comment on it
    if (intox.drunk >= 0.55 || intox.high >= 0.35) return roll < 0.6 ? pick(TIPSY_REACT) : null;
    if (intox.drunk >= 0.25) return roll < 0.25 ? pick(TIPSY_REACT) : null;
    return null;
}

/** All 300 lines, one list. */
export const BAR_LINES = [
    ...DRUNK, ...CLASSES, ...BOYS, ...BATHROOM, ...CIGARETTE,
    ...MUSIC, ...DRINKS, ...FRIENDS, ...FOOD, ...RANDOM
];
export const BAR_LINE_GROUPS = { DRUNK, CLASSES, BOYS, BATHROOM, CIGARETTE, MUSIC, DRINKS, FRIENDS, FOOD, RANDOM };

/**
 * A line for someone at a bar: each person works through their own shuffle of the list
 * (seeded by `seed`), so they don't repeat themselves and two people rarely say the same thing.
 */
export function barLine(seed, count) {
    const n = BAR_LINES.length;
    // A stride that's coprime with n walks every line once before repeating
    let stride = 1 + ((seed * 2654435761) >>> 0) % (n - 1);
    while (gcd(stride, n) !== 1) stride++;
    const start = ((seed * 40503) >>> 0) % n;
    return BAR_LINES[(start + count * stride) % n];
}
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
