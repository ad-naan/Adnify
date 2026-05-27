import { memo, useMemo } from 'react'
import { motion } from 'framer-motion'

interface RollingDigitProps {
    digit: string
    className?: string
}

const RollingDigit = memo(function RollingDigit({ digit, className }: RollingDigitProps) {
    const isNum = !isNaN(parseInt(digit, 10))
    if (!isNum) {
        return <span className={className}>{digit}</span>
    }

    const num = parseInt(digit, 10)

    return (
        <span className="inline-block overflow-hidden h-[1.2em] relative leading-[1.2em] w-[0.55em] text-center">
            <motion.span
                className="absolute left-0 right-0 flex flex-col items-center"
                initial={{ y: 0 }}
                animate={{ y: `-${num * 10}%` }}
                transition={{ type: 'spring', stiffness: 350, damping: 28 }}
                style={{ height: '1000%' }}
            >
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <span key={n} className={`${className} h-[10%] flex items-center justify-center select-none`}>
                        {n}
                    </span>
                ))}
            </motion.span>
        </span>
    )
})

export interface RollingNumberProps {
    value: string | number
    className?: string
}

export function RollingNumber({ value, className }: RollingNumberProps) {
    const valueStr = String(value)
    const chars = useMemo(() => valueStr.split(''), [valueStr])

    return (
        <span className="inline-flex items-center">
            {chars.map((char, index) => (
                <RollingDigit key={index} digit={char} className={className} />
            ))}
        </span>
    )
}
