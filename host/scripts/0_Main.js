import engine from "../engine.js"
import bmp from "bmp-js"
import fs from "fs"
engine.Register("Main", "1.0.0")
engine.network_name = "ybbobsille_main_12/14/2025"
engine.Vcheck("1.0.0")

class Map_Pixel extends engine.color {
    constructor(x, y, r, g, b, a, map) {
        super(r, g, b, a)
        this.x = x
        this.y = y
        this.map = map

        this.owner = r + g + b + a == 0 ? "void" : "wild"
        this.history = [0, 0, 0, 0]
    }

    get pos() {
        return [this.x, this.y]
    }

    get up() {
        return this.map.get(this.x, this.y + 1)
    }

    get down() {
        return this.map.get(this.x, this.y - 1)
    }

    get right() {
        return this.map.get(this.x + 1, this.y)
    }

    get left() {
        return this.map.get(this.x - 1, this.y)
    }

    get neighbors() {
        return [
            this.up,
            this.right,
            this.down,
            this.left
        ]
    }

    get changed() {
        return !this.rgba.equals(this.history)
    }

    Flush_Changes() {
        this.history = this.rgba
    }
}

class Map_Handler {
    raw = null;
    structures = [];

    constructor(name) {
        this.raw = this._read_bmp(`./maps/${name}.bmp`)
        this.flat = [];
        this.land = []
        this.height = this.raw[0].length
        this.width = this.raw.length

        this.raw.forEach(row => {
            row.forEach(p => {
                this.flat.push(p)
                if (p.owner != "void") {
                    this.land.push(p)
                }
            })
        })
    }

    get size() {
        return [this.width, this.height]
    }

    get_Square(x1, y1, x2, y2) {
        const pixels = []
        for (var x = x1; x <= x2; x++) {
            for (var y = y1; y <= y2; y++) {
                //console.log(x1,y1,x2,y2,x,y)
                pixels.push(this.get(x, y))
            }
        }
        return pixels
    }

    get_Circle(x, y, radius) {
        const x1 = x - radius
        const x2 = x + radius
        const y1 = y - radius
        const y2 = y + radius

        const candidates = this.get_Square(x1, y1, x2, y2)
        const result = candidates.map(pixel => engine.Distance(x, y, pixel.x, pixel.y) > radius ? null : pixel)
        return result.filter(pixel => pixel != null)
    }

    get(x, y) {
        if (x >= this.width) {
            x %= this.width
        }
        while (x < 0) {
            x += this.width
        }
        if (y >= this.height) {
            y %= this.height
        }
        while (y < 0) {
            y += this.height
        }

        //console.log(x,y,this.raw[x][y].x, this.raw[x][y].y)
        return this.raw[Math.round(x)][Math.round(y)]
    }

    Dump_Raw() {
        const height = this.raw.length;
        const width = this.raw[0].length;

        const data = [];

        for (let x = 0; x < width; x++) {
            data[x] = []
            for (let y = 0; y < height; y++) {
                const pixel = this.raw[y][x];
                const [r, g, b, a] = pixel.rgba
                data[x][y] = pixel.rgba
            }
        }

        return data
    }

    _read_bmp(file) {
        const bmpBuffer = fs.readFileSync(file);
        const bmpData = bmp.decode(bmpBuffer);

        const { data, width, height } = bmpData;

        const pixels = [];
        let idx = 0;

        for (let x = 0; x < width; x++) {
            const row = [];
            for (let y = 0; y < width; y++) {
                const b = data[idx++];
                const r = data[idx++];
                const g = data[idx++];
                const a = data[idx++];

                row.push(new Map_Pixel(x, y, r, g, b, a, this));
            }
            pixels.push(row);
        }
        return pixels
    }

    _dump_bmp() {
        const height = this.raw.length;
        const width = this.raw[0].length;

        const data = Buffer.alloc(width * height * 4); // RGBA output
        let idx = 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pixel = this.raw[y][x];
                const [r, g, b, a] = pixel.rgba

                data[idx++] = b;
                data[idx++] = r;
                data[idx++] = g;
                data[idx++] = a;
            }
        }

        const rawData = {
            data,
            width,
            height
        };

        const bmpBuffer = bmp.encode(rawData);
        return bmpBuffer
    }

    Find_Changes(max_changes) {
        var changes = [];
        //FIXME: make pixels report chaged to the map_handler to void checking every land pixel
        this.land.forEach(pixel => {
            if (pixel.changed) {
                changes.push(pixel)
            }
        })

        if (changes.length > max_changes * 5) {
            engine.Shuffle(changes)
        }
        changes = changes.splice(0, max_changes)
        changes.forEach(pixel => pixel.Flush_Changes())

        return changes.map(pixel => {
            return [pixel.x, pixel.y, ...pixel.rgba]
        })
    }

    Register_Structure(structure) {
        this.structures.push(structure)
    }
}

class Territory_Manager {
    land;
    territory;
    color;
    structures = [];

    constructor(land, territory, troops) {
        land = land.filter(pixel => pixel.owner != "void")
        this.land = land
        this.territory = territory
        this.troops = troops
        this.money = engine.public.settings.starting_money
        this.color = engine.public.territories[territory].color
        this.attacking_progress = {}
        this.dead = false

        land.forEach(pixel => {
            if (pixel.owner != "void") {
                pixel.Set_Filter("territory", this.color)
                pixel.owner = this.territory
            }
        })

        engine.public.territory_objects[territory] = this
    }

    get neighbors() {
        const borders = this.borders
        const territories = []
        borders.forEach(pixel => {
            if (!territories.includes(pixel.owner)) {
                territories.push(pixel.owner)
            }
        })
        return territories
    }

    get borders() {
        const borders = [];
        for (var pixel of this.land) {
            for (var neighbor of pixel.neighbors) {
                if (neighbor.owner != this.territory) {
                    borders.push(neighbor)
                }
            }
        }
        return borders
    }

    Claim_Land(x, y) {
        const pixel = engine.public.map.get(x, y)
        if (pixel.owner != "void") {
            if (pixel.owner != "wild") {
                const owner = engine.public.territory_objects[pixel.owner]
                const index = owner.land.indexOf(pixel)
                if (index != -1) {
                    owner.land.splice(index, 1)
                }
                if (owner.land.length == 0) {
                    this.money += owner.money
                    owner.money = 0
                    owner.troops = 0
                    owner.dead = true
                    console.log(
                        engine.public.territories[owner.territory].name,
                        "died to",
                        engine.public.territories[this.territory].name
                    )
                }
            }

            pixel.Set_Filter("territory", this.color)
            pixel.owner = this.territory
            this.land.push(pixel)

            return true
        }
        return false
    }

    bordering(territory) {
        for (var pixel of this.land) {
            for (var neighbor of pixel.neighbors) {
                if (neighbor.owner == territory) {
                    return true
                }
            }
        }

        return false
    }

    attack(territory, troop_percent) {
        const troop_count = Math.floor(this.troops * (troop_percent / 100))
        this.troops -= troop_count
        if (this.attacking_progress[territory]) {
            this.attacking_progress[territory] += troop_count
        }
        else {
            this.attacking_progress[territory] = troop_count
        }
    }

    attacking(territory) {
        return this.attacking_progress[territory] ? true : false
    }

    _tick() {
        const max_troops = this.land.length * engine.public.settings.territory_value
        const troop_percent = this.troops / max_troops
        const bordering = this.borders
        Object.entries(this.attacking_progress).forEach(([territory, troops]) => {
            //console.log(this.territory, ">", territory, troops)

            if (!this.bordering(territory)) {
                this.troops = Math.min(max_troops, this.troops + troops)
                troops = 0
            }
            if (troops <= 0) {
                delete this.attacking_progress[territory]
                return
            }
            bordering.forEach(pixel => {
                if (pixel.owner == territory && troops > 0) {
                    troops--
                    if (engine.Chance(troops / (max_troops / 6) * 100)) {
                        if (pixel.owner != "wild") troops -= Math.floor(((engine.public.territory_objects[pixel.owner]?.troops || 0) * engine.public.settings.attacking_cost) / troops)

                        this.Claim_Land(pixel.x, pixel.y)
                    }
                }
            })

            this.attacking_progress[territory] = troops
        })

        const [a, b, c, x] = [1, 2.5, 1, troop_percent * 5]
        this.troops += Math.pow(a * 2.718, -(Math.pow(x - b, 2) / 2 * Math.pow(c, 2)))
            * (max_troops * engine.public.settings.troop_gain_rate)

        this.troops = Math.min(max_troops, this.troops)
        this.money += Math.floor(this.troops * engine.public.settings.troop_income)
    }

    Register_Structure(structure) {
        this.structures.push(structure)
        engine.public.map.Register_Structure(structure)
    }
}

class Structure {

}

class City extends Structure {
    constructor(territory, x, y) {
        super()
        this.x = x
        this.y = y
        this.host = engine.public.map.get(x, y)
        this.owner = engine.public.territory_objects[territory]
        this.territory_object = engine.public.territory_objects[territory]

        this.territory_object.Register_Structure(this)

        if (this.owner.money < engine.public.settings.cost.city) {
            delete this
            throw new Error("Not enough money to buy city")
        }
        else {
            this.owner.money -= engine.public.settings.cost.city
        }

        // testing
        const city_color = new engine.color(255, 255, 255, 0)
        const circle = engine.public.map.get_Circle(x, y, 5)
        circle.forEach(pixel => {
            pixel.Set_Filter("structure", city_color, 2)
        })
    }
}

function Generate_Territory_Color() {
    const hues = Object.values(engine.public.territories).map(t => {
        const hsla = t.color.hsla
        return hsla ? hsla[0] : undefined
    }).filter(n => n != undefined);
    if (!hues || hues.length === 0) {
        return engine.color.From_HSLA(0, 45, 70, 50); // default hue if none exist
    }

    // Normalize and sort
    const sorted = hues
        .map(h => ((h % 360) + 360) % 360)
        .sort((a, b) => a - b);

    let maxGap = 0;
    let bestHue = 0;

    for (let i = 0; i < sorted.length; i++) {
        const current = sorted[i];
        const next = sorted[(i + 1) % sorted.length];

        // Wrap-around gap
        const gap = (i === sorted.length - 1)
            ? (360 - current + next)
            : (next - current);

        if (gap > maxGap) {
            maxGap = gap;
            bestHue = (current + gap / 2) % 360;
        }
    }

    return engine.color.From_HSLA(bestHue, 45, 70, 50);
}

function Register_Territory(name) {
    // Generates a uniqe id and color for each territory
    var id = null
    const Chars = "qwertyuiopasdfghjklzxcvbnmm"
    while (id == null) {
        id = ""
        for (var i = 0; i < 10; i++) id += Chars.charAt(Math.round(Math.random() * Chars.length))
        if (engine.public.territories[id]) {
            id = null
        }
    }
    engine.public.territories[id] = {
        name: name,
        color: Generate_Territory_Color()
    }
    return id
}

function _render_to_file(fp) {
    const data = engine.public.map._dump_bmp()
    fs.writeFileSync(fp, data.data)
}

export function tick() {
    if (global.tick_duration > (1000 / engine.tick_rate) * 0.8) {
        console.warn("Warning! tick duration is abnormaly high!")
    }
    fs.writeFileSync("./tick_duration.txt", `${global.tick_duration} (${Math.round(global.tick_duration / (1000 / engine.tick_rate) * 100)}%)`)

    Object.values(engine.public.territory_objects).forEach(TM => TM._tick())

    engine.network.Send_All({
        type: "map_update",
        data: engine.public.map.Find_Changes(5000)
    })

    _render_to_file("./out.bmp")

    if (engine.Tick_Index() % (global.Game_Settings.tick_rate * 30) == 0) {
        // refresh the map buffer every 30 seconds
        //console.log("Refreshing map buffer...")
        engine.public.map.flat.forEach(pixel => {
            pixel.history = null
        })
    }
}

export function init() {
    engine.public.map = new Map_Handler(engine.public.settings.map)
    engine.network.Send_All({
        type: "map_data",
        data: {
            size: engine.public.map.size
        }
    })
}

export function ui_script(handler) {
    handler.network.on_message("ybbobsille_main_12/14/2025", (msg) => {
        switch (msg.type) {
            case "map_data":
                handler.renderer.Size(msg.data.size[0], msg.data.size[1])
                handler.renderer.Set_Square(0, 0, msg.data.size[0], msg.data.size[1], 0, 0, 0)
                break;
            case "map_update":
                msg.data.forEach(([x, y, r, g, b, a]) => {
                    if (x === 100 && y === 100) {
                        console.log("Pixel 100,100:", r, g, b, a);
                    }
                    handler.renderer.Set_Pixel(x, y, r, g, b)
                })
                break
            default:
                break;
        }
    })
}

engine.public = {
    settings: {
        map: "basic",
        bots: true,
        bot_count: 10,
        troop_gain_rate: 0.05,
        territory_value: 4, // the number of troops to alow per-space.
        attacking_cost: 8,
        troop_income: 0.01, // the amount of money to get every tick for every troop 
        starting_money: 5000,
        cost: {
            city: 50000
        }
    },
    structures: {
        city: City
    },
    territories: {},
    territory_objects: {},

    map: null,

    Register_Territory,

    Territory_Manager: Territory_Manager
}