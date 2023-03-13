import { prisma } from '@/lib/prisma'
import { google } from 'googleapis'
import dayjs from 'dayjs'
import { NextApiRequest, NextApiResponse } from 'next'
import { z } from 'zod'
import { getGoogleOAuth } from '@/lib/google'

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(400).end()
  }

  const username = String(req.query.username)
  const user = await prisma.user.findUnique({
    where: {
      username,
    },
  })

  if (!user) return res.status(400).json({ messsage: 'User does not exist.' })

  const createSchedulingBody = z.object({
    name: z.string(),
    email: z.string().email(),
    observations: z.string(),
    date: z.string().datetime(),
  })

  const { name, email, observations, date } = createSchedulingBody.parse(
    req.body,
  )

  if (!date) {
    return res.status(400).json({ message: 'Date not provided.' })
  }

  const schedulingDate = dayjs(date).startOf('hour')

  console.log(schedulingDate, new Date())

  if (schedulingDate.isBefore(new Date())) {
    return res.status(400).json({
      message: 'Date is in the past.',
    })
  }

  const conflictingScheduling = await prisma.scheduling.findFirst({
    where: {
      user_id: user.id,
      date: schedulingDate.subtract(3, 'hour').toDate(),
    },
  })

  if (conflictingScheduling) {
    return res.status(400).json({
      message: 'There is another scheduling at the same time.',
    })
  }

  const scheduling = await prisma.scheduling.create({
    data: {
      name,
      email,
      observations,
      date: schedulingDate.subtract(3, 'hour').toDate(),
      user_id: user.id,
      created_at: new Date(),
    },
  })

  const calendar = google.calendar({
    version: 'v3',
    auth: await getGoogleOAuth(user.id),
  })

  await calendar.events.insert({
    calendarId: 'primary',
    conferenceDataVersion: 1,
    requestBody: {
      summary: `Ignite Call: ${name}`,
      description: observations,
      start: {
        dateTime: schedulingDate.format(),
      },
      end: {
        dateTime: schedulingDate.add(1, 'hour').format(),
      },
      attendees: [{ email, displayName: name }],
      conferenceData: {
        createRequest: {
          requestId: scheduling.id,
          conferenceSolutionKey: {
            type: 'hangoutsMeet',
          },
        },
      },
    },
  })

  return res.status(201).end()
}
