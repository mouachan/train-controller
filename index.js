const PoweredUP = require("node-poweredup").PoweredUP;
const mqtt = require('mqtt');

const legoPoweredUp = new PoweredUP();

const mqttBrokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const mqttTopic = process.env.MQTT_TOPIC || "train-command";
const legoMotorMaxPower = parseInt(process.env.LEGO_MOTOR_MAX_POWER || "50", 10);

const actionMap = {
    // SpeedLimit_30
    0: async (motor, led, hub) => {
        console.log("Handling SpeedLimit_30...")
        await motor.setPower(legoMotorMaxPower / 2);
    },
    // SpeedLimit_50
    1: async (motor, led, hub) => {
        console.log("Handling SpeedLimit_50...")
        await motor.setPower(legoMotorMaxPower);
    },
    // TrafficSignalsAhead
    2: async (motor, led, hub) => {
        console.log("Handling TrafficSignalsAhead...")
        // TODO
    },
    // PedestiranCrossingAhead
    3: async (motor, led, hub) => {
        console.log("Handling PedestiranCrossingAhead...")
        await motor.rampPower(legoMotorMaxPower, 0, 2000);
        await motor.brake();
    },
    // RedTrafficLight
    4: async (motor, led, hub) => {
        console.log("Handling RedTrafficLight...")
        await motor.brake();
    },
    // GreenTrafficLight
    5: async (motor, led, hub) => {
        console.log("Handling GreenTrafficLight...")
        for (i = 0; i < 2; i++) {
            await led.setBrightness(100);
            await hub.sleep(250);
            await led.setBrightness(0);
            await hub.sleep(250);
        }
        await motor.rampPower(legoMotorMaxPower / 3, legoMotorMaxPower, 5000);
    }
};

var legoGear = {
    hub: null,
    motor: null,
    led: null
};

console.log("Connecting to MQTT broker %s...", mqttBrokerUrl);
var mqttClient = mqtt.connect(mqttBrokerUrl);
mqttClient.on('connect', () => {
    console.log("Connected to MQTT broker %s!", mqttBrokerUrl);
    mqttClient.subscribe(mqttTopic, (err) => {
        if (!err) {
            console.log("Subscribed to topic %s!", mqttTopic);
        }
    });
});

var lastActionCode = -1;
var actionInProgress = true;
mqttClient.on('message', (topic, payload) => {
    console.log('Received message on MQTT topic %s: %s', topic, payload.toString());
    
    // the payload is a string representing an integer
    var actionCode = parseInt(payload.toString(), 10);
    var action = actionMap[actionCode];

    // Safety check
    if (typeof action !== "function") {
        console.log("Unknown action %s/%d...", payload.toString(), actionCode);
        return;
    }

    // Safety check
    if (legoGear == null || legoGear.motor == null || legoGear.led == null) {
        console.log("Not acting on %d since the Lego PoweredUp hub is not initialized yet!", actionCode);
        return;
    }

    // Ignore duplicate commands
    if (lastActionCode == actionCode) {
        console.log("Ignoring duplicate command %d!", actionCode);
        return;
    }

    // Do not accept commands if the previous one is still ongoing
    if (actionInProgress) {
        console.log("Ignoring command %d since the last one (%d) is still ongoing...", actionCode, lastActionCode);
        return;
    }

    // Acting on the lego gear for real
    lastActionCode = actionCode;
    actionInProgress = true;
    action(legoGear.motor, legoGear.led, legoGear.hub).then(() => {
        console.log("Processed command %d!", actionCode);
    }).catch((e) => {
        console.log(e);
    }).finally(() => {
        actionInProgress = false;
    });
});

mqttClient.on("close", () => {
    console.log("Disconnected from MQTT server");
});

legoPoweredUp.on("discover", async (hub) => {
    console.log(`Discovered ${hub.name}!`);
    // Stop the discovery process once we have a compatible Lego hub
    legoPoweredUp.stop();

    // Connect to the Hub
    await hub.connect();
    console.log("Connected to Lego Hub!");
    legoGear.hub = hub;

    // Make sure a motor is plugged into port A
    const motorA = await hub.waitForDeviceAtPort("A");
    legoGear.motor = motorA;

    // Make sure a led is plugged into port B
    const ledB = await hub.waitForDeviceAtPort("B");
    legoGear.led = ledB;
    
    // Let the MQTT client use the PoweredUp objects
    console.log("All hardware pieces have been discovered!");

    // Start the train
    await motorA.rampPower(legoMotorMaxPower / 3, legoMotorMaxPower, 5000);
    actionInProgress = false;
});

console.log("Scanning for Lego PoweredUp Hubs...");
legoPoweredUp.scan(); // Start scanning for Hubs

function cleanup () {
    var promises = [];
    if (mqttClient != null && mqttClient.connected) {
        console.log("Disconnecting from MQTT Broker...");
        promises.push(mqttClient.endAsync().then(() => {
            mqttClient = null;
        }));
    }

    if (legoGear.hub != null && (legoGear.hub.connected || legoGear.hub.connecting)) {
        console.log("Disconnecting from Lego Hub...");
        promises.push(legoGear.hub.disconnect().then(() => {
            console.log("PoweredUp Hub disconnected!");
            legoGear = { hub: null, motor: null, led: null };
        }));
    }

    Promise.all(promises).then(() => {
        console.log("Cleanup done!");
        process.exit(0);
    });
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
