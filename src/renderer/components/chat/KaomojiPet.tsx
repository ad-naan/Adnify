import { useState, useEffect } from 'react'

const KAOMOJI_FACES = [
    "(￣▽￣)", "(≧∇≦)ﾉ", "(oﾟvﾟ)ノ", "o(*￣▽￣*)o", "( ´ ▽ ` )", "(●'◡'●)",
    "(*/ω＼*)", "(*^▽^*)", "(T_T)", "(;-;)", "(=・ω・=)", "(~_~;)",
    "( *︾▽︾)", "(´;ω;`)", "(。・∀・)ノ", "(￣y▽￣)╭", "\\(￣︶￣*\\))",
    "(*^_^*)", "(p≧w≦q)", "(✿◡‿◡)", "♪(^∇^*)"
]

const PET_MESSAGES: Record<string, string[]> = {
    en: [
        "I'm sleepy...", "Need more code!", "Feed me tokens!", "Looking good!",
        "No bugs today?", "Pondering the universe...", "Waiting for input...",
        "Bored...", "Ready to help!", "Just chilling...", "Thinking..."
    ],
    zh: [
        "想睡觉觉...", "赐予我代码吧！", "好饿，喂点 token！", "今天也很帅气！",
        "今天没有 Bug 吧？", "思考宇宙的起源...", "敲点什么吧...",
        "好无聊...", "时刻准备帮忙！", "发呆中...", "脑暴中..."
    ]
}

export function KaomojiPet({ language = 'en' }: { language?: string }) {
    const [face, setFace] = useState(KAOMOJI_FACES[0])
    const [message, setMessage] = useState(PET_MESSAGES[language]?.[0] || PET_MESSAGES.en[0])

    useEffect(() => {
        const list = PET_MESSAGES[language] || PET_MESSAGES.en
        setFace(KAOMOJI_FACES[Math.floor(Math.random() * KAOMOJI_FACES.length)])
        setMessage(list[Math.floor(Math.random() * list.length)])

        const interval = setInterval(() => {
            const currentList = PET_MESSAGES[language] || PET_MESSAGES.en
            const idxFace = Math.floor(Math.random() * KAOMOJI_FACES.length)
            const idxMsg = Math.floor(Math.random() * currentList.length)

            setFace(KAOMOJI_FACES[idxFace])
            setMessage(currentList[idxMsg])
        }, Math.floor(Math.random() * 3000) + 4000)

        return () => clearInterval(interval)
    }, [language])

    return (
        <div
            className="text-[11px] font-mono text-accent animate-pulse font-bold select-none tracking-widest opacity-80 hover:opacity-100 transition-opacity drop-shadow-sm cursor-help flex items-center gap-2"
            title="Your dynamic pet!"
        >
            <span>{face}</span>
            <span className="font-sans font-bold text-[10px] tracking-wide bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent animate-gradient drop-shadow-sm">{message}</span>
        </div>
    )
}
