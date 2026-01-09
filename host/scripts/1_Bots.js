import engine from "../engine.js"
engine.Vcheck("1.0.0")
const { Main } = engine.Register("Bots", "1.0.0", {"Main":"1.0.0"})

const bots = []
var bot_placements = null
const bot_config = {
    /* 
    deviation:
        currently calculated by taking a random -1 to 1 value as x, and the max deviation as y: x⁴ * y
    */

    // related to the pre-game phase where you select your location
    start: {
        // the ideal minimum distance to keep other territories
        ideal_distance: 15,
        // how fast the willingness to stay decays after ideal distance (higher is more tolerent to close territories)
        distance_falloff: {   
            player: 0.7,
            bot: 0.9
        },
        // starting size of the bots territory
        starting_size:3.5,
        // how fast it will grow loyal to its position and fight for it
        position_loyalty: 0.2,
        // how fast it will gorw stressful of its current position, and more willing to give it up
        position_stress: 0.15,
        // how fast it will lose stress when there is no-one close
        stress_decay: 0.1,
        // when the bot will start feeling stress when the willingness is below this point
        stress_point: 7.5,
        // the initial value for willingness
        base_willingness: 10,
        // the starting troop count
        troop_count: 500
    },
    // related to the main phase of the game
    General: {
        // how much the bot will respect players/bots
        // this will effect how much the bots will alliance/attack players/bots
        // NOTE: respect.player is cot currently used
        respect: {
            player: 0.8,
            bot: 0.8 
        },
        // this is how much deviation to have in the respect (chosen at game start for each bot)
        // the respect for bots and players will be limited between 1 and 0
        respect_deviation: {
            player: 0.3,
            bot: 0.3
        },
        // how patience the bot will be, so lower means more urgency to: gain land, spread out, etc. (limited to 0-1)
        patience: 0.5,
        patience_deviation: 0.4
    },
    // related to the 'early' phase of the game
    Early: {
        Attack_Chance: 0.1,
        // the chance that the bot will change targets
        Focus_Switch: 0.2,
        // the amount of money to move from 'early' to 'main' phase
        Required_Money: 100000
    }
}

class Bot_Handler {
    constructor(name, id) {
        this.bot_id = id
        this.name = name
        this.territory = Main.Register_Territory(name)
        this.selected_pixels = []
        this.target_location = null
        this.current_location = null
        this.position_loyalty = 0
        this.position_stress = 0
    }

    async Tick_Starting_Location() {
        const Pick_New_Target_Location = () => {
            var map_size = Main.map.size
            var start_size = bot_config.start.starting_size
            this.target_location = null
            while (!this.target_location
                || Main.map.get(this.target_location[0], this.target_location[1])?.owner == "void"
            ) {
                this.target_location = [
                    engine.Clamp(Math.round(Math.random() * map_size[0]), start_size, map_size[0] - start_size),
                    engine.Clamp(Math.round(Math.random() * map_size[1]), start_size, map_size[1] - start_size)
                ]
            }
        }
        const Selection_Location = (x, y) => {
            this.position_stress = 0
            this.position_loyalty = 0
            this.selected_pixels.forEach(pixel => {
                if (pixel.owner == this.territory) {
                    pixel.Set_Filter("territory", null)
                    pixel.owner = "wild"
                }
            });
            this.current_location = [x, y]
            this.selected_pixels = Main.map.get_Circle(x, y, bot_config.start.starting_size)
            
            this.selected_pixels.forEach(pixel => {
                if (pixel.owner != "void") {
                    pixel.Set_Filter("territory", Main.territories[this.territory].color)
                    pixel.owner = this.territory
                }
            });
        }

        if (!this.target_location) Pick_New_Target_Location()

        if (this.current_location) {
            var willingness = bot_config.start.base_willingness
            //TODO: include player pos's in the relitvent placements
            const relivent_placments = bot_placements.filter(p => engine.Distance(p[0], p[1], this.current_location[0], this.current_location[1]) < bot_config.start.ideal_distance)
            
            relivent_placments.forEach(point => {
                const distance = engine.Distance(this.current_location[0], this.current_location[1], point[0], point[1])
                // 0 - 1
                const score = (Math.max(-distance + bot_config.start.ideal_distance, 0) / bot_config.start.ideal_distance)

                willingness -= score * (point[2] == "bot" ? bot_config.start.distance_falloff.bot : bot_config.start.distance_falloff.player)
            })

            if (willingness != 7.5) {
                this.position_stress += bot_config.start.position_stress
            }
            else {
                this.position_stress -= bot_config.start.stress_decay
            }

            if ((willingness + this.position_loyalty - this.position_stress) < (Math.random() * bot_config.start.base_willingness)) {
                Pick_New_Target_Location()
                Selection_Location(this.target_location[0], this.target_location[1])
            }
            else {
                this.position_loyalty +=  bot_config.start.position_loyalty
            }
        }
        else {
            Selection_Location(this.target_location[0], this.target_location[1])
        }

        // every 5th tick try to reclaim land within the circle
        if (engine.Tick_Index() % 5 == 0) {
            this.selected_pixels.forEach(pixel => {
                if (pixel.owner == "wild") {
                    pixel.owner = this.territory
                    pixel.Set_Filter("territory", Main.territories[this.territory].color)
                }
            })
        }
    }

    async Tick_Game() {
        if (this.land?.dead) {
            // remove bot from update pool
            const index = bots.indexOf(this)
            if (index != -1) {
                bots.splice(index, 1)
            }
            return
        }
        if (this.current_location) {
            //clean up starting data and init game data
            this.land = new Main.Territory_Manager(this.selected_pixels, this.territory, bot_config.start.troop_count)

            delete this.selected_pixels
            delete this.target_location
            delete this.current_location
            delete this.position_loyalty
            delete this.position_stress

            this.phase = "initial"
            this.respect = {
                player: bot_config.General.respect.player + calculate_deviation(bot_config.General.respect_deviation.player),
                bot: bot_config.General.respect.bot + calculate_deviation(bot_config.General.respect_deviation.bot)
            }
            this.patience = bot_config.General.patience + calculate_deviation(bot_config.General.patience_deviation)
        }

        const calc_neighbor_threat = () => {
            const bordering_terr = this.land.neighbors.filter(t => t != "void")
            
            const sizes = bordering_terr.map(tn => 
                Main.territory_objects[tn]?.land?.length
            )
            const my_size = this.land.land.length
            const low = Math.min(...sizes, my_size)
            const high = Math.max(...sizes, my_size) - low
            const scores = sizes.map(s => (s - low) / high)
            const my_score = (my_size - low) / high

            const attack_candidates = Object.fromEntries(scores.map(s => 
                    [bordering_terr[scores.indexOf(s)], 1 - s]
                ))
            return [attack_candidates, my_score]
        }
        
        // updates are only needed every once and while
        const freqency = {
            "initial":1,
            "early":2,
            "main":5
        }
        if ((engine.Tick_Index() + this.bot_id) % (freqency[this.phase]) != 0) return

        if (this.phase == "initial") {
            //this phase is purely just claim land. it will move the 'early' phase if there is no wild to claim.

            if (this.land.bordering("wild")) {
                if (!this.land.attacking("wild") && engine.Chance(this.patience * 30)) this.land.attack("wild", 20)
            }
            else {
                this.phase = "early"
                this.focusless = 0
            }
        }
        else if (this.phase == "early") {
            // this phase mainly about getting land from others.

            if (!this.focus) {
                const [threats, my_score] = calc_neighbor_threat()
                if (Object.keys(threats).length == 0) {
                    this.phase = "main"
                    return 
                }
                const attack_candidates = Object.fromEntries(
                    Object.entries(threats).filter(e => 
                        e[1] * this.respect.bot > my_score || this.focusless > 30
                    )
                )
                
                for (var n of Object.keys(attack_candidates)) {
                    if (engine.Chance(50 + (45 * attack_candidates[n]) + (this.focusless / 2)) || this.focusless > 100) {
                        this.focus = n
                        this.focus_strength = attack_candidates[n]
                        break
                    }
                }
                if (!this.focus) {
                    // just pick a random one if all else fails
                    const target = Object.entries(attack_candidates)[0]
                    if (!target) {
                        this.focusless += 1
                        return
                    }
                    
                    this.focus = target[0]
                    this.focus_strength = target[1]
                }
            }
            else {
                this.focusless = 0
            }

            if (this.focus) {
                if (engine.Chance(bot_config.Early.Attack_Chance * this.patience * 100)) {
                    if (!this.land.attacking(this.focus)) {
                        this.land.attack(this.focus, 20)
                    } 
                }
                else if (!this.land.attacking(this.focus) && engine.Chance(bot_config.Early.Focus_Switch * 100)) {
                    this.focus = null
                }
            }

            if (this.land.money >= bot_config.Early.Required_Money) {
                this.phase = "main"
            }
        }
        else if (this.phase == "main") {
            if (this._new_main_phase != true) {
                this._new_main_phase = true
                this.focus = null
                console.log(this.name, "is in main phase")
            }

            const [threats, my_score] = calc_neighbor_threat()
            
            Object.keys(threats).forEach(tn => {
                threats[tn] = {
                    score: threats[tn],
                    attacking: Main.territory_objects[tn].attacking(this.territory)
                }
            })

            for (var tn of Object.keys(threats)) {
                if (threats[tn].attacking && !this.land.attacking(tn)) {
                    this.land.attack(tn, 20)
                    break;
                }
            }

            if (Main.map.get(100, 100).owner == this.territory && this._city_test != true) {
                console.log("Starting city test...")
                this._city_test = true
                this._city = new Main.structures.city(this.territory, 100, 100)
            }
        }
    }
}

function calculate_deviation(deviation) {
    var y = deviation
    var x = Math.random() * 2 - 1 // random -1 to 1 value
    return Math.pow(x, 4) * y // devalues low numbers to make high deviation uncommon
}

export async function tick() {
    if (engine.Is_Started()) {
        for (var bot of bots) {
            await bot.Tick_Game()
        }
    }
    else {
        bot_placements = bots.map(bot => [...(bot.current_location ? bot.current_location : [null]), "bot"]).filter(p => p != null)
        for (var bot of bots) {
            await bot.Tick_Starting_Location()
        }
    }
}

export function init() {
    if (!Main.settings.bots || Main.settings.bot_count == 0) return

    for (var i=0; i<Main.settings.bot_count; i++) {
        bots.push(new Bot_Handler(`Bot_${i}`, i))
    }
}