import axios from 'axios'
import { installAdminInterceptors } from './admin'

export const api = axios.create({
  baseURL: '/api',
  timeout: 15_000,
})

installAdminInterceptors(api)
