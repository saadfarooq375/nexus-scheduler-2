// Google Calendar Integration
// Uses Google Identity Services (GIS) + GAPI

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = 'https://www.googleapis.com/auth/calendar';

let tokenClient = null;
let gapiInited = false;
let gisInited = false;

export function initGoogle(onReady) {
  // Load GAPI
  const gapiScript = document.createElement('script');
  gapiScript.src = 'https://apis.google.com/js/api.js';
  gapiScript.onload = () => {
    window.gapi.load('client', async () => {
      await window.gapi.client.init({
        discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
      });
      gapiInited = true;
      if (gisInited) onReady();
    });
  };
  document.body.appendChild(gapiScript);

  // Load GIS
  const gisScript = document.createElement('script');
  gisScript.src = 'https://accounts.google.com/gsi/client';
  gisScript.onload = () => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: '',
    });
    gisInited = true;
    if (gapiInited) onReady();
  };
  document.body.appendChild(gisScript);
}

export function signIn(callback) {
  tokenClient.callback = async (resp) => {
    if (resp.error) {
      console.error('Google sign-in error:', resp);
      return;
    }
    callback(true);
  };
  if (window.gapi.client.getToken() === null) {
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    tokenClient.requestAccessToken({ prompt: '' });
  }
}

export function signOut() {
  const token = window.gapi.client.getToken();
  if (token) {
    window.google.accounts.oauth2.revoke(token.access_token);
    window.gapi.client.setToken('');
  }
}

export function isSignedIn() {
  return window.gapi?.client?.getToken() !== null;
}

// Fetch events for the current week
export async function fetchWeekEvents(weekStart) {
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  try {
    const response = await window.gapi.client.calendar.events.list({
      calendarId: 'primary',
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100,
    });

    const items = response.result.items || [];
    return items.map(event => ({
      id: event.id,
      title: event.summary || '(No title)',
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      color: categorizeEvent(event.summary || ''),
      category: getCategoryName(event.summary || ''),
      description: event.description || '',
      googleEvent: true,
    }));
  } catch (err) {
    console.error('Error fetching calendar events:', err);
    return [];
  }
}

// Create a new event
export async function createCalendarEvent({ title, startDateTime, endDateTime, description = '' }) {
  try {
    const response = await window.gapi.client.calendar.events.insert({
      calendarId: 'primary',
      resource: {
        summary: title,
        description,
        start: { dateTime: startDateTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        end: { dateTime: endDateTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      },
    });
    return response.result;
  } catch (err) {
    console.error('Error creating event:', err);
    throw err;
  }
}

// Update an existing event
export async function updateCalendarEvent(eventId, updates) {
  try {
    const existing = await window.gapi.client.calendar.events.get({
      calendarId: 'primary',
      eventId,
    });
    const event = { ...existing.result, ...updates };
    const response = await window.gapi.client.calendar.events.update({
      calendarId: 'primary',
      eventId,
      resource: event,
    });
    return response.result;
  } catch (err) {
    console.error('Error updating event:', err);
    throw err;
  }
}

// Delete an event
export async function deleteCalendarEvent(eventId) {
  try {
    await window.gapi.client.calendar.events.delete({
      calendarId: 'primary',
      eventId,
    });
    return true;
  } catch (err) {
    console.error('Error deleting event:', err);
    throw err;
  }
}

// Color-code events based on keywords
function categorizeEvent(title) {
  const t = title.toLowerCase();
  if (t.includes('deep work') || t.includes('focus') || t.includes('writing') || t.includes('coding') || t.includes('design')) return '#F59E0B';
  if (t.includes('meet') || t.includes('call') || t.includes('sync') || t.includes('standup') || t.includes('interview')) return '#3B82F6';
  if (t.includes('content') || t.includes('post') || t.includes('video') || t.includes('podcast') || t.includes('record')) return '#14B8A6';
  if (t.includes('admin') || t.includes('email') || t.includes('review') || t.includes('planning')) return '#6B7280';
  return '#8B5CF6';
}

function getCategoryName(title) {
  const t = title.toLowerCase();
  if (t.includes('deep work') || t.includes('focus') || t.includes('writing') || t.includes('coding')) return 'deep-work';
  if (t.includes('meet') || t.includes('call') || t.includes('sync')) return 'meeting';
  if (t.includes('content') || t.includes('post') || t.includes('video')) return 'content';
  if (t.includes('admin') || t.includes('email')) return 'admin';
  return 'other';
}
