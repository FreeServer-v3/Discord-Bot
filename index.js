require("dotenv").config();
const {
	Client,
	Intents,
	Channel,
	MessageActionRow,
	MessageSelectMenu,
	MessageButton,
} = require("discord.js");
const client = new Client({
	intents: [Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILDS],
});

const dashurl = process.env.DASH_URL;
const uri = process.env.DB_URI;

const { MongoClient, ObjectId } = require("mongodb");
const mdbclient = new MongoClient(uri);
const mdb = mdbclient.db("DiscordBot");
(async () => {
	await mdbclient.connect();
	console.log("Connected to the database.");
})();

const fetch = require("node-fetch");
const cron = require("node-cron");

const adminUserId = ["490731820552290324", "292596328226095104"];
let questionState = {
    isActive: false,
    messageId: null,
    userId: null,
    amount: 0,
    answers: [],
    timer: null,
    question: ''
};
let dclogdata = "";
let userSelectionGlobal = {};
let ratelimit = {};
let exp = {};
let userLevelCache = {};

client.on("ready", () => {
	console.log(`Logged in as ${client.user.tag}!`);
});

function resetQuestionState() {
    if (questionState.timer) {
        clearTimeout(questionState.timer);
    }
    questionState = {
        isActive: false,
        messageId: null,
        userId: null,
        amount: 0,
        answers: [],
        timer: null,
        question: ''
    };
}

async function levelup(userId) {
	await dclog("DB", `Level up user data into db: \`${userId}\``);
	const collection = mdb.collection("level");
	const level = await collection.findOne({ user: userId });
	if (!level) {
		await collection.insertOne({
			user: userId,
			level: 2,
		});
		return 2;
	}

	await collection.updateOne(
		{ user: userId },
		{ $set: { level: level.level + 1 } }
	);
	return level.level + 1;
}

async function addexp(userId, expe) {
	if (!exp[userId]) {
		exp[userId] = 0;
	}
	exp[userId] = exp[userId] + expe;
	if (!userLevelCache[userId]) {
		userLevelCache[userId] = await getLevel(userId);
		if (!userLevelCache[userId]) {
			userLevelCache[userId] = 1;
		}
	}
	const requiredExp = Math.floor(
		1000 * ((userLevelCache[userId] * 0.05) ** 0.8 + 0.909)
	);
	if (exp[userId] >= requiredExp) {
		const multiplier = await getActiveBooster();
		if (multiplier > 1) {
			const boosters = await getActivateFboosters();
			if (boosters) {
				boosters.forEach(async (booster) => {
					const boosterUser = await getUser(booster.user);
					await setUserCoins(
						booster.user,
						parseInt(boosterUser.info.coins) + 8
					);
				});
			}
		}
		const level = await levelup(userId);
		exp[userId] = exp[userId] - requiredExp;
		const user = await getUser(userId);
		const mention = await getUserMention(userId);
		if (user.error) {
			await sendAnnounce(
				"<:icon_discord_chat:1162324964943343638>",
				`+0`,
				`<@${userId}> 升級到了等級 ${level}! 但他沒有註冊帳號，所以升級獎勵被沒收ㄌ`,
				mention
			);
		} else {
			try {
				await setUserCoins(
					userId,
					parseInt(user.info.coins) + Math.round(50 * multiplier)
				);
			} catch (error) {
				console.log(error);
			}
			await sendAnnounce(
				"<:icon_discord_chat:1162324964943343638>",
				`+50`,
				`<@${userId}> 升級到了等級 ${level}!`,
				mention
			);
			if (multiplier > 1) {
				const boosters = await getActivateFboosters();
				if (boosters) {
					boosters.forEach(async (booster) => {
						if (booster.user == interaction.user.id) return;
						const bmention = await getUserMention(booster.user);
						await sendAnnounce(
							"<:icon_discord_rules:1162325284763222107>",
							`+8`,
							`<@${booster.user}> ${await client.cache.user.get(userId).username} 升級了，你因 FBooster 獲得了 8 <:freecoin:1171871969617117224>!`,
							bmention
						);
					});
				}
			}
		}
		userLevelCache[userId] = level;
		return true;
	}
	return false;
}

async function getExp(userId) {
	if (!exp[userId]) {
		exp[userId] = 0;
	}
	return exp[userId];
}

async function getLevel(userId) {
	await dclog("DB", `Get user level data from db: \`${userId}\``);
	const collection = mdb.collection("level");
	const level = await collection.findOne({ user: userId });
	return level ? level.level : false;
}

async function randSaperator() {
	const decorations = [":", "：", "•", ".", "·"];

	let prevDecoration = null;
	let result = "";

	for (let i = 0; i < 20; i++) {
		let decoration = null;

		if (prevDecoration != ":" && Math.random() < 0.25) {
			decoration = ":";
		} else if (prevDecoration != "：" && Math.random() < 0.25) {
			decoration = "：";
		} else {
			let randIndex;
			do {
				randIndex = Math.floor(Math.random() * (decorations.length - 2)) + 2;
			} while (decorations[randIndex] === prevDecoration);

			decoration = decorations[randIndex];
		}

		if (prevDecoration != "：" && decoration != "：") {
			result += " ";
		}

		result += decoration;

		prevDecoration = decoration;
	}
	return result;
}

async function dclog(type, content) {
	if (type == "DUMP") {
		if (dclogdata.length == 0) return;

		await client.channels.cache.get("1161357738610270313").send(dclogdata);
		dclogdata = "";
		return;
	}

	const data = `<t:${Math.floor(Date.now() / 1000)}:f> [${type}] ${content}`;
	dclogdata = dclogdata.length ? `${dclogdata}\n${data}` : data;

	if (dclogdata.split("\n").length > 10) {
		await client.channels.cache.get("1161357738610270313").send(dclogdata);
		dclogdata = "";
	}
}

async function setActivateBooster(userId, boosterId) {
	await dclog("DB", `Set booster data into db: \`${userId} ${boosterId}\``);
	const collection = mdb.collection("booster");
	const booster = await collection.findOne({ _id: new ObjectId(boosterId) });
	if (!booster) {
		return false;
	} else if (booster.user != userId.toString()) {
		return false;
	}
	const multiplier = booster.multiplier;
	const lasts = booster.lasts;
	const collection2 = mdb.collection("actbooster");
	await collection2.insertOne({
		user: userId,
		multiplier: multiplier,
		expires: Math.floor(Date.now() / 1000) + lasts * 3600,
	});
	await collection.deleteOne({ _id: new ObjectId(boosterId) });
	await sendFboosterAnnounce(userId, multiplier, lasts);
	return true;
}

async function getActiveBooster() {
	await dclog("DB", `Get booster data from db`);
	const collection = mdb.collection("actbooster");
	const boosters = await collection.find({}).toArray();
	if (!boosters) {
		return 1.0;
	}
	let multiplier = 1.0;
	boosters.forEach((booster) => {
		multiplier = multiplier + parseFloat(booster.multiplier) - 1;
	});
	return multiplier.toFixed(1);
}

async function getActivateFboosters() {
	await dclog("DB", `Get fboosters data from db`);
	const collection = mdb.collection("actbooster");
	const boosters = await collection.find({}).toArray();
	return !boosters || boosters.length === 0 ? false : boosters;
}

async function deleteOutdatedBoosters() {
	const collection = mdb.collection("actbooster");
	const boosters = await collection.find({}).toArray();
	if (!boosters) {
		return;
	}
	boosters.forEach(async (booster) => {
		if (booster.expires < Math.floor(Date.now() / 1000)) {
			await dclog(
				"DB",
				`Delete outdated boosters from db (ID: ${booster._id})`
			);
			collection.deleteOne({ _id: new ObjectId(booster._id) });
		}
	});
	return true;
}

async function getUserFboosters(userId) {
	await dclog("DB", `Get user fbooster data from db: \`${userId}\``);
	const collection = mdb.collection("booster");
	const boosters = await collection.find({ user: userId }).toArray();
	return !boosters || boosters.length === 0 ? false : boosters;
}

async function inviteIntoDB(userId, inviterId) {
	await dclog(
		"DB",
		`Put invite data into db: \`${userId} invited by ${inviterId}\``
	);
	const collection = mdb.collection("invites");
	const check = await collection.findOne({ user: userId });
	if (check) {
		return false;
	}
	await collection.insertOne({
		user: userId,
		inviter: inviterId,
	});
	return true;
}

async function getInviterFromDB(userId) {
	await dclog("DB", `Get inviter data from db: \`${userId}\``);
	const collection = mdb.collection("invites");
	const check = await collection.findOne({ user: userId });
	return check ? check.inviter : false;
}

async function setUserMention(userId, mention) {
	await dclog("DB", `Set user mention data into db: \`${userId} ${mention}\``);
	const collection = mdb.collection("mention");
	if (mention) {
		await collection.deleteOne({ user: userId });
	} else {
		await collection.insertOne({ user: userId });
	}
}

async function getUserMention(userId) {
	await dclog("DB", `Get user mention data from db: \`${userId}\``);
	const collection = mdb.collection("mention");
	const check = await collection.findOne({ user: userId });
	return !check;
}

async function signIntoDB(userId) {
	await dclog("DB", `\`${userId}\` has signed today`);
	const collection = mdb.collection("sign");
	await collection.insertOne({ user: userId });
	return true;
}

async function getSignFromDB(userId) {
	await dclog("DB", `Get sign data from db: \`${userId}\``);
	const collection = mdb.collection("sign");
	const check = await collection.findOne({ user: userId });
	return Boolean(check);
}

async function clearSignsFromDB() {
	await dclog("DB", `Clearing all signs...`);
	const collection = mdb.collection("sign");
	await collection.deleteMany({});
	return true;
}

cron.schedule("0 0 * * *", async () => {
	console.log("Clearing signs...");
	clearSignsFromDB();
	deleteOutdatedBoosters();
});

cron.schedule("* * * * *", async () => {
	fetch("https://uptime.freeserver.tw/api/push/Vo52SSQ5YM?status=up&msg=OK&ping=")
});

async function getAD() {
	try {
		const response = await fetch('https://cdn.freeserver.tw/ad/list.json');
		if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
		}
		const adList = await response.json();
		
		if (adList.length === 0) {
		throw new Error('Ad list is empty');
		}
		
		const randomIndex = Math.floor(Math.random() * adList.length);
		return adList[randomIndex];
	} catch (error) {
		console.error('Error fetching or processing ad list:', error);
		return null;
	}
}

async function getUser(id) {
	await dclog("DB", `Getting user data via api \`${id}\``);
	const url = `${process.env.DASH_URL}/api/admin/user/getFromID`;
	const headers = {
		"Content-Type": "application/json",
		api: `${process.env.DASH_API_KEY}`,
		bypasswaf: `${process.env.WAF_BYPASS_KEY}`,
	};
	const data = {
		id: `${id}`,
	};

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: headers,
			body: JSON.stringify(data),
		});
		const userData = await response.json();
		return userData;
	} catch (error) {
		console.error(error);
	}
}

async function setUserCoins(id, coins) {
	await dclog("DB", `Setting user coins via api \`${id}\`, \`${coins}\`FC`);
	const url = `${process.env.DASH_URL}/api/admin/user/setUserCoinByID`;
	const headers = {
		"Content-Type": "application/json",
		api: `${process.env.DASH_API_KEY}`,
		bypasswaf: `${process.env.WAF_BYPASS_KEY}`,
	};
	const data = {
		id: `${id}`,
		coins: `${coins}`,
	};

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: headers,
			body: JSON.stringify(data),
		});
		const userData = await response.json();
		return userData;
	} catch (error) {
		console.error(error);
	}
}

async function sendAnnounce(emoji, amount, content, mention) {
	const channel = client.channels.cache.get(process.env.ANNOUNCE_CHANNEL);
	const saperator = await randSaperator();
	if (mention) {
		await channel.send(`${saperator}
##  ${emoji} ${amount} <:freecoin:1171871969617117224>
>  ${content}`);
	} else {
		await channel.send({
			content: `${saperator}
##  ${emoji} ${amount} <:freecoin:1171871969617117224>
>  ${content}`,
			allowedMentions: { parse: [] },
		});
	}
	return true;
}

async function sendFboosterAnnounce(user, multiplier, lasts) {
	const saperator = await randSaperator();
	const channel = client.channels.cache.get(process.env.ANNOUNCE_CHANNEL);
	const expiryDate = new Date();
	expiryDate.setHours(expiryDate.getHours() + parseInt(lasts));
	const expiryUnixTime = Math.floor(expiryDate.getTime() / 1000);
	const nowMultiplier = await getActiveBooster();
	await channel.send(`${saperator}
# <a:icon_discord_nitro:1162325260675326045> FBooster 已啟動!
> <@${user}> 啟用了時長為 ${lasts} 小時，倍數為 ${multiplier} 倍的 FBooster!
> 此 FBooster 將於 <t:${expiryUnixTime}:R> 到期；目前倍數: ${nowMultiplier}倍
- <@&1179484728009695272>`);
	return true;
}

client.on("messageCreate", async (message) => {
	// check if admin
	if (adminUserId.includes(message.author.id)) {
		if (message.content.startsWith("!set")) {
			const args = message.content.split(" ");
			if (args.length != 3)
				return message.reply(
					`請輸入正確的指令格式: \`!set <user id> <amount>\``
				);
			const user = await getUser(args[1]);
			if (user.error) return message.reply(`找不到該用戶...`);

			await setUserCoins(args[1], args[2]);
			return message.reply(
				`已成功設定該用戶的 FreeCoin 數量為 ${args[2]} <:freecoin:1171871969617117224>`
			);
		}

		// add user coins
		if (message.content.startsWith("!add")) {
			const args = message.content.split(" ");
			if (args.length != 3)
				return message.reply(
					`請輸入正確的指令格式: \`!add <user id> <amount>\``
				);

			const user = await getUser(args[1]);
			if (user.error) return message.reply(`找不到該用戶...`);

			await setUserCoins(args[1], user.info.coins + parseInt(args[2]));
			return message.reply(
				`已成功增加該用戶的 FreeCoin 數量為 ${args[2]} <:freecoin:1171871969617117224>`
			);
		}

		// get raw user info
		if (message.content.startsWith("!get")) {
			const args = message.content.split(" ");
			if (args.length != 2)
				return message.reply(`請輸入正確的指令格式: \`!get <user id>\``);

			const user = await getUser(args[1]);
			if (user.error) return message.reply(`找不到該用戶...`);

			return message.reply(`data: \`\`\`json\n${JSON.stringify(user)}\`\`\``);
		}

		// clear signs
		if (message.content.startsWith("!cs")) {
			await clearSignsFromDB();
			return message.reply(`已成功清除所有簽到記錄。`);
		}

		// dump logs
		if (message.content.startsWith("!dump")) {
			await dclog("DUMP", " ");
			return message.reply(`已成功傳送所有日誌。`);
		}
	}

	// level event
	if (message.channel.id !== "1161357738211819647n") {
		if (message.author.bot) return;
		const regex = /<(@|:)[^>]+>/g;
		const messageLength = message.content.replace(regex, "").length;
		const isLevelUp = await addexp(
			message.author.id,
			Math.floor(messageLength)
		);
		if (isLevelUp) message.react("<:icon_discord_chat:1162324964943343638>");
	}

	// reply question
	if (message.channelId == process.env.QUESTION_CHANNEL) {
        if (
            !questionState.isActive ||
            message.reference?.messageId !== questionState.messageId
        ) return;
    
        if (message.author.id === questionState.userId) {
            return message.reply(`你回答自己的問題幹嘛....`);
        }
    
        try {
            if (!questionState.answers.includes(message.content)) {
                return message.react("❌");
            }
    
            await message.react("<:icon_checkmark:1173699014538039417>");
            await message.reply(`Wooo! 你答對了! 正在發放獎勵...`);
    
            const channel = client.channels.cache.get(process.env.QUESTION_CHANNEL);
            if (channel) {
                try {
                    const questionMessage = await channel.messages.fetch(questionState.messageId);
                    await questionMessage.edit(
                        `# 此問題已結束!\n某人找到正確答案ㄌ...\n<@&1171902415436525629>`
                    );
                } catch (error) {
                    console.error('更新問題訊息時發生錯誤:', error);
                }
            }
    
            const user = await getUser(message.author.id);
            if (user.error) {
                resetQuestionState();
                return message.reply(`真是可惜，你沒有註冊...只好把獎勵充公ㄌowo`);
            }
    
            await setUserCoins(message.author.id, user.info.coins + questionState.amount);
            const response = await message.reply(
                `你已成功獲得 ${questionState.amount} <:freecoin:1171871969617117224>`
            );
    
            // 重置狀態
            resetQuestionState();
            return response;
        } catch (error) {
            console.error('處理答案時發生錯誤:', error);
            resetQuestionState();
            return message.reply('處理答案時發生錯誤，請通知管理員。');
        }
    }

	// user join event
	if (message.channelId == 1161357738610270314n) {
		try {
			const json = JSON.parse(message.content);
			if (json.type == "join") {
				if (json.unknown || json.self) return;

				const check = await inviteIntoDB(json.joinerid, json.inviterid);
				if (!check) return;

				const inviter = await getUser(json.inviterid);
				if (inviter.error) return;

				const multiplier = await getActiveBooster();
				await setUserCoins(
					json.inviterid,
					parseInt(inviter.info.coins) + Math.round(10 * multiplier)
				);
				if (multiplier > 1) {
					const boosters = await getActivateFboosters();
					if (boosters) {
						boosters.forEach(async (booster) => {
							const boosterUser = await getUser(booster.user);
							await setUserCoins(
								booster.user,
								parseInt(boosterUser.info.coins) + 3
							);
						});
					}
				}

				const mention = await getUserMention(json.inviterid);
				await sendAnnounce(
					"<:icon_discord_invite:1162325232275705896>",
					`+${Math.round(10 * multiplier)}`,
					`${json.invitertag} 邀請了 ${json.joinertag} 加入了伺服器!`,
					mention
				);
				if (multiplier > 1) {
					const boosters = await getActivateFboosters();
					if (boosters) {
						boosters.forEach(async (booster) => {
							const bmention = await getUserMention(booster.user);
							await sendAnnounce(
								"<:icon_discord_rules:1162325284763222107>",
								`+3`,
								`<@${booster.user}> ${json.invitername} 邀請了某個成員，你因 FBooster 獲得了 3 <:freecoin:1171871969617117224>!`,
								bmention
							);
						});
					}
				}
			} else if (json.type == "leave") {
				if (json.unknown || json.self) return;

				const inviter = await getInviterFromDB(json.joinerid);
				if (inviter.error) return;

				const inviterUser = await getUser(inviter);
				if (inviterUser.info.coins)
					await setUserCoins(
						json.inviterid,
						parseInt(inviterUser.info.coins) - 10
					);

				const mention = await getUserMention(json.inviterid);
				return sendAnnounce(
					"<:icon_discord_leave:1179857501169127434>",
					"-10",
					`${json.invitertag} 邀請的 ${json.joinertag} 離開了伺服器 :(`,
					mention
				);
			}
		} catch (error) {
			console.log(error);
		}
	}
});

client.on("interactionCreate", async (interaction) => {
	if (!interaction.isCommand()) return;

	await dclog(
		"COMMAND",
		`${interaction.user.id} Used cocmmand: /${interaction.commandName}`
	);

	if (
		interaction.channelId != 1161357738211819647n &&
		!adminUserId.includes(interaction.user.id)
	) {
		await interaction.reply({ content: "你要不要看看頻道名稱是啥?" });
		return;
	}

	if (!adminUserId.includes(interaction.user.id)) {
		if (
			ratelimit[interaction.user.id] &&
			Date.now() - ratelimit[interaction.user.id] < 5000
		) {
			await interaction.reply({
				content: "你的指令速度太快了! 請稍後再試。",
				ephemeral: true,
			});
			return;
		}
	}
	ratelimit[interaction.user.id] = Date.now();

	if (interaction.commandName === "ping") {
		await interaction.reply("嗨!");
	}

	if (interaction.commandName === "help") {
		await interaction.reply(`## 指令幫助
        > </help:1171802229330677811> - 顯示此幫助頁面
        > </ping:1171802229330677810> - 確認機器人狀態
        > </freecoin:1171827811527426059> - 獲得自己的 FreeCoin 數量
        > </transfer:1171866796689723433> - 轉移 FreeCoin 給別人，會收取 5% 手續費
        > </feecalculate:1171874197681741965> - 計算轉移手續費
        > </fbooster:1171879343954337882> - 查看或使用 FBooster [[?]](<https://docs.freeserver.tw/freecoin/fbooster>)
        > </multiplier:1179867829370110086> - 查看目前的 FBooster 倍數
        > </sign:1171894002199564288> - 簽到，每日可獲得 0-4 FreeCoin [[?]](<https://docs.freeserver.tw/freecoin/gain/discord/sign>)
        > </question:1171894002199564289> - 付費在聊天室發起問題 [[?]](<https://docs.freeserver.tw/freecoin/gain/discord/answer>)
        > </level:1182931451541463081> - 查看自己的聊天等級
        > </togglemention:1180229420577992836> - 開啟或關閉獲得 FreeCoin 時的提醒

還有其他問題? [可以查看我們的文檔](<https://docs.freeserver.tw/>)
        `);
	}

	if (interaction.commandName === "freecoin") {
		await interaction.deferReply();
		const user = await getUser(interaction.user.id);
		if (user.error) {
			await interaction.followUp(`找不到你的帳號...請前往 ${dashurl} 註冊。`);
			return;
		}
		await interaction.followUp(
			`你剩餘的 FreeCoin: ${user.info.coins} <:freecoin:1171871969617117224>`
		);
	}

	if (interaction.commandName === "feecalculate") {
		let amount = interaction.options.getInteger("數量");
		if (isNaN(amount)) {
			amount = Math.ceil(parseFloat(amount) * 100) / 100;
		}
		const fee = Math.ceil(amount * 0.05);
		await interaction.reply(
			`欲轉移 ${amount} <:freecoin:1171871969617117224> ，手續費為 ${fee} <:freecoin:1171871969617117224>；共需支付 ${amount + fee} <:freecoin:1171871969617117224>。`
		);
	}

	if (interaction.commandName === "transfer") {
		const target = interaction.options.getUser("使用者");
		let amount = interaction.options.getInteger("數量");

		if (target.id == interaction.user.id) {
			await interaction.reply(`轉給自己很好玩...嗎?`);
			return;
		}

		if (amount == 0) {
			await interaction.reply(`轉 0 是要...顯示你很窮嗎?`);
			return;
		}

		const MathAnswersString = [
			"經過計算，小明現在年齡-27歲",
			"由此得證，公車上最後有-37.45個人",
		];
		if (amount < 0) {
			await interaction.reply(
				`哇!負數耶! 你以後數學考卷答案最好就寫 "${MathAnswersString[Math.floor(Math.random() * MathAnswersString.length)]}"`
			);
			return;
		}

		await interaction.deferReply();

		const user = await getUser(interaction.user.id);
		if (user.error) {
			await interaction.followUp(`找不到你的帳號...請前往 ${dashurl} 註冊。`);
			return;
		}
		if (isNaN(amount)) {
			amount = Math.ceil(parseFloat(amount) * 100) / 100;
		}
		const fee = Math.ceil(amount * 0.05);
		if (user.info.coins < amount + fee) {
			await interaction.followUp(
				`你沒有足夠的 <:freecoin:1171871969617117224>! (若要轉移${amount} <:freecoin:1171871969617117224>，需要 ${amount + fee} <:freecoin:1171871969617117224>，其中 ${fee} <:freecoin:1171871969617117224> 為手續費)`
			);
			return;
		}
		const targetUser = await getUser(target.id);
		if (targetUser.error) {
			await interaction.followUp(
				`你要轉的人好像沒有註冊或不存在耶...叫他去 ${dashurl} 註冊!`
			);
			return;
		}
		await setUserCoins(interaction.user.id, user.info.coins - amount);
		await setUserCoins(target.id, targetUser.info.coins + amount);
		await interaction.followUp(
			`已成功轉移 ${amount} <:freecoin:1171871969617117224> 給 ${target.username}，手續費為 ${fee} <:freecoin:1171871969617117224>`
		);
	}

	if (interaction.commandName === "fbooster") {
		await interaction.deferReply({ ephemeral: true });
		const user = await getUser(interaction.user.id);
		if (user.error) {
			await interaction.followUp(`找不到你的帳號...請前往 ${dashurl} 註冊。`);
			return;
		}
		if (interaction.options.getString("動作") == "view") {
			const boosters = await getUserFboosters(interaction.user.id);
			if (!boosters) {
				await interaction.followUp("你沒有任何 FBooster。");
				return;
			}
			let message = "## 你的 🚀FBooster 列表:\n";
			let i = 0;
			boosters.forEach((booster) => {
				i++;
				message = `${message}\n> ${i}. ID: ${booster._id} | ${booster.multiplier} 倍，作用時長: ${booster.lasts} 小時`;
			});
			await interaction.followUp(message);
		} else if (interaction.options.getString("動作") == "buy") {
			await interaction.followUp(
				"你還不能購買 FBooster。詳見 [Docs](<https://docs.freeserver.tw/freecoin/fbooster/gain>)"
			);
		} else if (interaction.options.getString("動作") == "use") {
			const userBoosters = await getUserFboosters(interaction.user.id);
			if (!userBoosters) {
				await interaction.followUp("你沒有任何 FBooster。");
				return;
			}
			let options = [];
			userBoosters.forEach((booster) => {
				options.push({
					label: `${booster._id} | ${booster.multiplier} 倍，作用時長: ${booster.lasts} 小時`,
					value: `${booster._id}`,
				});
			});
			const row = new MessageActionRow().addComponents(
				new MessageSelectMenu()
					.setCustomId("fboosterselect")
					.setPlaceholder("選擇一個你的 FBooster...")
					.addOptions(options)
			);
			await interaction.followUp({
				content: "選擇你要啟動的 Fbooster:",
				components: [row],
			});
		}
	}

	if (interaction.commandName === "multiplier") {
		const multiplier = await getActiveBooster();
		const boosters = await getActivateFboosters();
		await interaction.reply({
			content: `## 目前的倍數為 ${multiplier} 倍。${boosters ? `\n\n### 目前啟用的 FBooster:\n${boosters.map((booster) => `> 使用者: <@${booster.user}> | ${booster.multiplier} 倍，<t:${booster.expires}:R> 到期`).join("\n")}` : ""}`,
			allowedMentions: { parse: [] },
		});
	}

	if (interaction.commandName === "sign") {
		const checkSigned = await getSignFromDB(interaction.user.id);
		if (checkSigned) {
			await interaction.reply(`你已經簽到過ㄌ! 明天再來8`);
			return;
		}
		await interaction.deferReply();
		const user = await getUser(interaction.user.id);
		if (user.error) {
			await interaction.followUp(`找不到你的帳號...請前往 ${dashurl} 註冊。`);
			return;
		}

		const random = Math.floor(Math.random() * 3) + 1;
		const multiplier = await getActiveBooster();
		const amount = Math.ceil(random * multiplier);
		const inviter = await getInviterFromDB(interaction.user.id);

		await setUserCoins(interaction.user.id, user.info.coins + parseInt(amount));
		if (inviter) {
			const inviterUser = await getUser(inviter);
			if (!inviterUser.error) {
				await setUserCoins(inviter, parseInt(inviterUser.info.coins) + 1);
			}
		}
		if (multiplier > 1) {
			const boosters = await getActivateFboosters();
			if (boosters) {
				boosters.forEach(async (booster) => {
					if (booster.user == interaction.user.id) return;
					const boosterUser = await getUser(booster.user);
					await setUserCoins(
						booster.user,
						parseInt(boosterUser.info.coins) + Math.round(random / 2)
					);
				});
			}
		}
		await signIntoDB(interaction.user.id);

		let ad;
		if (Math.random() < 0.3) {
			ad = await getAD();
		}

		await interaction.followUp({
			content: `已成功簽到! 你獲得了 ${amount} <:freecoin:1171871969617117224> ${multiplier > 1 ? `(${random}+${amount - random}加成)` : ""}! ${inviter ? `你的邀請者 <@${inviter}> 獲得了 1 <:freecoin:1171871969617117224>!` : ""}${ad ? `\n-# 由 **${ad.name}** 提供的贊助商廣告: [**${ad.text}**](<${ad.url}>)     [_[贊助說明]_](<https://freeserver.tw/donate>)` : ""}`,
			allowedMentions: { parse: [] },
		});

		const mention = await getUserMention(interaction.user.id);
		await sendAnnounce(
			"<:icon_discord_rules:1162325284763222107>",
			`+${amount}`,
			`<@${interaction.user.id}> 簽到了!`,
			mention
		);
		if (inviter) {
			const inviterMention = await getUserMention(inviter);
			await sendAnnounce(
				"<:icon_discord_invite:1162325232275705896>",
				`+1`,
				`<@${inviter}> 邀請的 ${interaction.user.username} 簽到了!`,
				inviterMention
			);
		}
		if (multiplier > 1) {
			const boosters = await getActivateFboosters();
			if (boosters) {
				boosters.forEach(async (booster) => {
					if (booster.user == interaction.user.id) return;
					const bmention = await getUserMention(booster.user);
					await sendAnnounce(
						"<:icon_discord_rules:1162325284763222107>",
						`+${Math.round(random / 2)}`,
						`<@${booster.user}> ${interaction.user.username} 簽到了，你因 FBooster 獲得了 ${Math.round(random / 2)} <:freecoin:1171871969617117224>!`,
						bmention
					);
				});
			}
		}
		return;
	}

	if (interaction.commandName === "question") {
        await interaction.deferReply({ ephemeral: true });
        if (questionState.isActive) {
            await interaction.followUp(`目前有人在出題中，請稍後再試。`);
            return;
        }
        const amount = interaction.options.getInteger("數量");
        if (amount <= 0) {
            await interaction.followUp(`你要付給別人.....多少錢?蛤?`);
            return;
        }
        if (amount < 15) {
            await interaction.followUp(
                `太少了啦，至少要超過 15 <:freecoin:1171871969617117224> 。`
            );
            return;
        }
        const question = interaction.options.getString("問題");
        if (
            question.includes("<@") ||
            question.includes("@everyone") ||
            question.includes("@here") ||
            question.includes("<!@")
        ) {
            await interaction.followUp(
                `Hmm. 你是不是在嘗試亂tag? 把所有的提及刪掉再試一次。`
            );
            return;
        }
        const user = await getUser(interaction.user.id);
        if (user.error) {
            await interaction.followUp(
                `找不到你的帳號，因此你付不了 FreeCoin...請前往 ${dashurl} 註冊。`
            );
            return;
        }
        if (user.info.coins < amount) {
            await interaction.followUp(`你沒有足夠的 FreeCoin 可以支付!`);
            return;
        }
    
        await setUserCoins(interaction.user.id, user.info.coins - amount);
        
        // 更新問題狀態
        questionState.isActive = true;
        questionState.userId = interaction.user.id;
        questionState.amount = amount;
        questionState.answers = interaction.options.getString("正確解答").split(",");
        questionState.question = question;
    
        const qmessage = `
    # 新的問題! 
    
    <:icon_discord_channel:1162324963424993371> 發起人: <@${interaction.user.id}>
    <:icon_discord_channel:1162324963424993371> 獎勵: ${amount} <:freecoin:1171871969617117224>
    <:icon_discord_channel:1162324963424993371> 出題者的問題如下:
    
    > ## ${question}
    
    剩餘時間: <t:${Math.floor(Date.now() / 1000) + 60}:R>
    <@&1171902415436525629>
        `;
    
        try {
            const questionMessage = await client.channels.cache
                .get(process.env.QUESTION_CHANNEL)
                .send(qmessage);
            
            questionState.messageId = questionMessage.id;
    
            // 設置計時器
            if (questionState.timer) {
                clearTimeout(questionState.timer);
            }
            questionState.timer = setTimeout(async () => {
                try {
                    if (questionState.isActive) {
                        await questionMessage.edit(
                            `# 此問題已結束!\n問題:${question}\n好像沒有人答對...\n<@&1171902415436525629>`
                        );
                        resetQuestionState();
                    }
                } catch (error) {
                    console.error('計時器處理錯誤:', error);
                    resetQuestionState();
                }
            }, 60000);
    
            await interaction.followUp(
                `已成功發起問題: https://discord.com/channels/1161357736819302500/${process.env.QUESTION_CHANNEL}/${questionState.messageId} ，請等待回答。`
            );
        } catch (error) {
            console.error('發送問題時發生錯誤:', error);
            resetQuestionState();
            await interaction.followUp('發送問題時發生錯誤，請稍後再試。');
        }
    }

	if (interaction.commandName === "togglemention") {
		const mention = await getUserMention(interaction.user.id);
		if (mention) {
			await interaction.reply(`已成功關閉提及功能。`);
			await setUserMention(interaction.user.id, false);
		} else {
			await interaction.reply(`已成功開啟提及功能。`);
			await setUserMention(interaction.user.id, true);
		}
	}

	if (interaction.commandName === "level") {
		const level = await getLevel(interaction.user.id);
		const exper = await getExp(interaction.user.id);
		const requiredExp = Math.floor(1000 * ((level * 0.05) ** 0.8 + 0.909));
		if (!level) {
			await interaction.reply(`## 你的等級: 1\n經驗值: \`${exper}/1000\``);
			return;
		}
		await interaction.reply(
			`## 你的等級: ${level}\n經驗值: \`${exper}/${requiredExp}\``
		);
	}
});

client.on("interactionCreate", async (interaction) => {
	if (!interaction.isSelectMenu()) return;

	if (interaction.customId == "fboosterselect") {
		const userSelection = interaction.values[0];
		userSelectionGlobal[interaction.user.id] = userSelection;

		const row = new MessageActionRow().addComponents(
			new MessageButton()
				.setCustomId("fboosterconfirm")
				.setLabel("確認")
				.setStyle("SUCCESS"),
			new MessageButton()
				.setCustomId("fboostercancel")
				.setLabel("取消")
				.setStyle("DANGER")
		);

		return interaction.update({
			content: `你確定你要啟用 Fbooster (ID:\`${userSelection}\`) 嗎?`,
			components: [row],
		});
	}
});

client.on("interactionCreate", async (interaction) => {
	if (!interaction.isButton()) return;

	if (interaction.customId === "fboosterconfirm") {
		const result = await setActivateBooster(
			interaction.user.id,
			userSelectionGlobal[interaction.user.id]
		);
		if (!result) {
			await interaction.update({
				content: `找不到該 FBooster 或該 FBooster 不屬於你。`,
				components: [],
			});
			return;
		}
		await interaction.update({
			content: `已成功使用 FBooster!`,
			components: [],
		});
		return;
	} else if (interaction.customId === "fboostercancel") {
		await interaction.update({
			content: `已取消使用 FBooster。`,
			components: [],
		});
		return;
	}
});

client.login(process.env.DISCORD_TOKEN);

process.on("unhandledRejection", async (error) => {
	console.error(error.stack || error);
});

process.on("uncaughtException", async (error) => {
	console.error(error.stack);
});

process.on("uncaughtExceptionMonitor", async (error) => {
	console.error(error.stack);
});
