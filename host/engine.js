//#region array.prototype.equals
// Source - https://stackoverflow.com/a
// Posted by Tomáš Zato, modified by community. See post 'Timeline' for change history
// Retrieved 2025-12-14, License - CC BY-SA 4.0

// Warn if overriding existing method
if (Array.prototype.equals)
    console.warn("Overriding existing Array.prototype.equals. Possible causes: New API defines the method, there's a framework conflict or you've got double inclusions in your code.");
// attach the .equals method to Array's prototype to call it on any array
Array.prototype.equals = function (array) {
    // if the other array is a falsy value, return
    if (!array)
        return false;
    // if the argument is the same array, we can be sure the contents are same as well
    if (array === this)
        return true;
    // compare lengths - can save a lot of time 
    if (this.length != array.length)
        return false;

    for (var i = 0, l = this.length; i < l; i++) {
        // Check if we have nested arrays
        if (this[i] instanceof Array && array[i] instanceof Array) {
            // recurse into the nested arrays
            if (!this[i].equals(array[i]))
                return false;
        }
        else if (this[i] != array[i]) {
            // Warning - two different object instances will never be equal: {x:20} != {x:20}
            return false;
        }
    }
    return true;
}
// Hide method from for-in loops
Object.defineProperty(Array.prototype, "equals", { enumerable: false });
//#endregion

class Color {
    _filter = {}
    filter = null

    constructor(r, g, b, a) {
        this._r = r
        this._g = g
        this._b = b
        this._a = a
    }

    get r() {
        return this._Apply_Filter(this._r, this.filter?.r)
    }

    get g() {
        return this._Apply_Filter(this._g, this.filter?.g)
    }

    get b() {
        return this._Apply_Filter(this._b, this.filter?.b)
    }

    get a() {
        return this._Apply_Filter(this._a, this.filter?.a)
    }

    Set_Filter(name, value, z = 1) {
        //console.log(value?.r)
        if (value == null) {
            delete this._filter[name]
            if (Object.values(this._filter).length == 0) {
                this.filter = null
                return
            }
        }
        else {
            this._filter[name] = {
                value,
                z
            }
        }

        const values = Object.values(this._filter).sort((a, b) => a.z - b.z).map(c => c.value.rgba)
        var [ r,g,b,a ] = [0,0,0,0]
        for (var [ _r,_g,_b,_a ] of values) {
            r = this._Apply_Filter(r, _r)
            g = this._Apply_Filter(g, _g)
            b = this._Apply_Filter(b, _b)
            a = this._Apply_Filter(a, _a)
        }

        this.filter = {
            r, g, b, a
        }
    }

    _Apply_Filter(value, filter) {
        return (filter ?? value)
    }

    static From_HSLA(h, s, l, a) {
        s = s / 100
        l = l / 100
        a = a / 100

        const C = (1 - Math.abs(2 * l - 1)) * s;
        const Hp = h / 60;
        const X = C * (1 - Math.abs((Hp % 2) - 1));

        let r1, g1, b1;
        if (0 <= Hp && Hp < 1) [r1, g1, b1] = [C, X, 0];
        else if (1 <= Hp && Hp < 2) [r1, g1, b1] = [X, C, 0];
        else if (2 <= Hp && Hp < 3) [r1, g1, b1] = [0, C, X];
        else if (3 <= Hp && Hp < 4) [r1, g1, b1] = [0, X, C];
        else if (4 <= Hp && Hp < 5) [r1, g1, b1] = [X, 0, C];
        else[r1, g1, b1] = [C, 0, X];

        const m = l - C / 2;

        return new Color(
            Math.round((r1 + m) * 255),
            Math.round((g1 + m) * 255),
            Math.round((b1 + m) * 255),
            a * 100
        )
    }

    get hsla() {
        const R = this.r / 255;
        const G = this.g / 255;
        const B = this.b / 255;

        const max = Math.max(R, G, B);
        const min = Math.min(R, G, B);
        const delta = max - min;

        let h, s, l;
        l = (max + min) / 2;

        if (delta === 0) {
            h = 0;
            s = 0;
        } else {
            s = delta / (1 - Math.abs(2 * l - 1));

            switch (max) {
                case R:
                    h = 60 * (((G - B) / delta) % 6);
                    break;
                case G:
                    h = 60 * ((B - R) / delta + 2);
                    break;
                case B:
                    h = 60 * ((R - G) / delta + 4);
                    break;
            }
        }

        if (h < 0) h += 360;

        return [h, s * 100, l * 100, this.a];
    }

    get rgba() {
        const bottom = this
        const top = this.filter
        if (!top) return [this.r, this.g, this.b, this.a]
        //console.log(top)
        // bottom = {r,g,b,a}, top = {r,g,b,a}
        const aA = bottom.a / 255;
        const aB = top.a / 255;

        const outA = aB + aA * (1 - aB);

        if (outA === 0) return [0, 0, 0, 0];

        const r = (top.r * aB + bottom.r * aA * (1 - aB)) / outA;
        const g = (top.g * aB + bottom.g * aA * (1 - aB)) / outA;
        const b = (top.b * aB + bottom.b * aA * (1 - aB)) / outA;

        return [
            Math.round(r),
            Math.round(g),
            Math.round(b),
            Math.round(outA * 255)
        ];

    }
}

class Network_Handler {
    _message_buffer = {

    }
    network_name = null

    constructor(users) {
        this.users = users
        global.network_handlers.push(this)
    }

    Send_All(data) {
        this.users.forEach(user => {
            this.Send_User(data, user)
        })
    }

    Send_User(data, user) {
        if (!engine.network_name) {
            throw "engine.network_name is null, Please set this to a uniqe id."
        }
        this.network_name = engine.network_name

        if (!this._message_buffer[user]) {
            this._message_buffer[user] = []
        }

        this._message_buffer[user].push(data)
    }

    On_Message(callback) {

    }
}

const engine = {
    version: {
        name: "1.0.0",
        major: 1,
        minor: 0,
        patch: 0
    },
    users: [],
    package_name: "",
    user_connections: [],
    game_settings: {
    },
    tick_rate: 0,
    network: new Network_Handler(Object.keys(global.users_connections)),
    network_name: null,

    public: {
        // put any values you wish to share with other packages here
    },

    Vcheck: (expected, terminal = true) => {
        // checks if the provided version is the same as the engine version.
        // - terminal: whether to through an error if its incorrect.
        if (expected != engine.version.name) {
            if (terminal) throw `Version mismatch for module '${engine.package_name}'`
            else return false
        }

        return true
    },
    Is_Started() {
        // returns true if the game has started.
        return global.game_started
    },
    Clamp(value, min, max) {
        // clamps value between min and max
        return Math.min(max, Math.max(min, value))
    },
    Distance(x1, y1, x2, y2) {
        // returns the distance from (x1, y1) to (x2, y2)
        return Math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2))
    },
    Tick_Index() {
        // returns the current tick index (number of ticks since start)
        return global.tick_index
    },
    Register(package_name, package_version, dependancies = {}) {
        // used to make your script accessable to other packages (not required)
        /*
        dependancies: {
            "<package_name>": str | array<str>
        }
        */

        engine.package_name = package_name
        engine.package_version = package_version
        global.engine_store[package_name] = { engine, version: package_version }
        const engines = {}
        for (var name of Object.keys(dependancies)) {
            engines[name] = engine.Get_Package(name, dependancies[name])
        }

        return engines
    },
    Get_Package(package_name, package_version) {
        // get a package based on the name
        const exists = Object.keys(global.engine_store).includes(package_name)
        if (!exists) throw `Package '${package_name}' is not loaded! Is it installed? And is the install order correct?`

        const real_version = global.engine_store[package_name].version

        const valid_version = typeof package_version == "string" ? real_version == package_version : package_version.includes(real_version)
        if (!valid_version) throw `Package '${package_name}' is version '${real_version}'. Requested version '${package_version}'`

        return global.engine_store[package_name].engine.public
    },
    Chance(num) {
        return Math.random() * 100 < num
    },
    Random_entry(list) {
        return list[Math.round(Math.random() * list.length)]
    },
    Average(values) {
        var sum = 0
        values.forEach(n => sum += n)
        return sum / values.length
    },
    Shuffle(array) {
        let currentIndex = array.length;

        // While there remain elements to shuffle...
        while (currentIndex != 0) {

            // Pick a remaining element...
            let randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex--;

            // And swap it with the current element.
            [array[currentIndex], array[randomIndex]] = [
                array[randomIndex], array[currentIndex]];
        }
    },

    color: Color
}

engine.users = global.users
engine.game_settings = global.Game_Settings
engine.tick_rate = global.Game_Settings.tick_rate

export default engine