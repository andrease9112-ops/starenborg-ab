import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler, Image, Linking, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, Switch, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { fetch } from 'expo/fetch';
import { randomUUID } from 'expo-crypto';
import { createPortalApi } from './portalApi';
import { portalConfig } from './portalConfig';

const sessionKey = 'starenborg.portal.refresh.v1';
const maxBytes = 15_000_000;
const portal = createPortalApi(portalConfig, fetch);
const logo = require('./assets/logo.png');

function discard(uri) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (error) {
    console.warn('Kunde inte rensa en tillfällig fil.', error.code);
  }
}

function Button({ title, onPress, primary = false, disabled = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, primary && styles.primary, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{title}</Text>
    </Pressable>
  );
}

function ReceiptScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [files, setFiles] = useState([]);
  const [session, setSession] = useState(null);
  const [remember, setRemember] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [customerId, setCustomerId] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [working, setWorking] = useState(false);
  const actionLock = useRef(false);
  const previousUser = useRef(null);
  const pendingCompany = files.find(file => file.upload)?.upload.customerId;
  const camera = useRef(null);

  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const saved = await SecureStore.getItemAsync(sessionKey);
        if (!saved) return;
        const account = await portal.refresh(saved);
        await SecureStore.setItemAsync(sessionKey, account.refreshToken);
        if (!active) return;
        previousUser.current = account.userId;
        setRemember(true);
        setSession(account);
        setCustomerId(account.customers.length === 1 ? account.customers[0].id : null);
        if (!account.customers.length) setMessage('Kontot är ännu inte kopplat till ett kundföretag.');
      } catch (error) {
        if (error.status === 400 || error.status === 401) {
          await SecureStore.deleteItemAsync(sessionKey).catch(() => {});
        }
        if (active) setMessage('Den sparade inloggningen kunde inte öppnas. Logga in igen.');
      } finally {
        if (active) setRestoring(false);
      }
    }
    restore();
    return () => { active = false; };
  }, []);

  async function openCamera() {
    if (actionLock.current) return;
    actionLock.current = true;
    setWorking(true);
    setMessage('');
    try {
      const access = permission?.granted ? permission : await requestPermission();
      if (!access.granted) {
        setMessage('Tillåt kameran i telefonens inställningar för att fotografera underlag.');
        return;
      }
      setSessionCount(0);
      setCameraReady(false);
      setCameraOpen(true);
    } catch {
      setMessage('Kameran kunde inte öppnas.');
    } finally {
      actionLock.current = false;
      setWorking(false);
    }
  }

  function closeCamera() {
    if (actionLock.current) return;
    if (photo) discard(photo.uri);
    setPhoto(null);
    setCameraReady(false);
    setCameraOpen(false);
  }

  useEffect(() => {
    if (!cameraOpen) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!actionLock.current) {
        if (photo) discard(photo.uri);
        setPhoto(null);
        setCameraReady(false);
        setCameraOpen(false);
      }
      return true;
    });
    return () => back.remove();
  }, [cameraOpen, photo]);

  async function capture() {
    if (actionLock.current || !cameraReady || !camera.current) return;
    actionLock.current = true;
    setCapturing(true);
    setMessage('');
    try {
      const result = await camera.current.takePictureAsync({ quality: 0.85 });
      if (!result?.uri) throw new Error('Bilden saknas.');
      if (new File(result.uri).size > maxBytes) {
        discard(result.uri);
        setMessage('Bilden överstiger 15 MB. Ta ett nytt foto.');
        return;
      }
      setPhoto({ uri: result.uri, name: 'Kvitto-' + Date.now() + '.jpg', image: true, mime: 'image/jpeg' });
    } catch {
      setMessage('Fotot kunde inte sparas. Försök igen.');
    } finally {
      actionLock.current = false;
      setCapturing(false);
    }
  }

  function acceptPhoto() {
    if (!photo) return;
    setFiles(current => [...current, photo]);
    setSessionCount(count => count + 1);
    setPhoto(null);
  }

  async function pickFiles() {
    if (actionLock.current) return;
    actionLock.current = true;
    setWorking(true);
    setMessage('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const accepted = [];
      let skipped = 0;
      for (const asset of result.assets) {
        const image = asset.mimeType?.startsWith('image/')
          || /\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/i.test(asset.name);
        const pdf = asset.mimeType === 'application/pdf' || /\.pdf$/i.test(asset.name);
        const size = new File(asset.uri).size;
        if ((!image && !pdf) || !size || size > maxBytes) {
          discard(asset.uri);
          skipped++;
          continue;
        }
        const mime = pdf ? 'application/pdf'
          : asset.mimeType?.startsWith('image/') ? asset.mimeType : 'application/octet-stream';
        accepted.push({ uri: asset.uri, name: asset.name, image: Boolean(image), mime });
      }
      setFiles(current => [...current, ...accepted]);
      if (skipped) setMessage(skipped + ' filer kunde inte läggas till. Välj bilder eller PDF-filer på högst 15 MB per fil.');
    } catch {
      setMessage('Filerna kunde inte hämtas. Försök igen.');
    } finally {
      actionLock.current = false;
      setWorking(false);
    }
  }

  function removeFile(uri) {
    discard(uri);
    setFiles(current => current.filter(file => file.uri !== uri));
  }

  async function signIn() {
    if (actionLock.current || !email.trim() || !password) return;
    actionLock.current = true;
    setWorking(true);
    setMessage('');
    try {
      const account = await portal.login(email.trim(), password);
      try {
        if (remember) await SecureStore.setItemAsync(sessionKey, account.refreshToken);
        else await SecureStore.deleteItemAsync(sessionKey);
      } catch {
        setRemember(false);
        setMessage('Du är inloggad, men telefonen kunde inte spara inloggningen.');
      }
      const sameUser = previousUser.current === account.userId;
      if (!sameUser) {
        files.forEach(file => discard(file.uri));
        setFiles([]);
      }
      previousUser.current = account.userId;
      setSession(account);
      const previousCompany = sameUser && account.customers.find(customer => customer.id === pendingCompany);
      setCustomerId(previousCompany ? previousCompany.id
        : account.customers.length === 1 ? account.customers[0].id : null);
      if (!account.customers.length) setMessage('Kontot är ännu inte kopplat till ett kundföretag. Kontakta Starenborg.');
    } catch {
      setMessage('Inloggningen misslyckades. Kontrollera uppgifterna och försök igen.');
    } finally {
      setPassword('');
      actionLock.current = false;
      setWorking(false);
    }
  }

  async function send() {
    if (actionLock.current || !session || !customerId || !files.length) return;
    if (pendingCompany && customerId !== pendingCompany) {
      setMessage('Ta bort återstående filer från föregående inskick innan du väljer ett annat företag.');
      return;
    }
    actionLock.current = true;
    setWorking(true);
    setSending(true);
    setMessage('');
    let sent = 0;
    try {
      let account = session;
      for (const document of files) {
        if (account.expiresAt <= Date.now() + 60_000) {
          account = await portal.refresh(account.refreshToken);
          setSession(account);
          if (remember) {
            await SecureStore.setItemAsync(sessionKey, account.refreshToken).catch(() => setRemember(false));
          }
        }
        document.upload ??= { id: randomUUID(), customerId };
        await portal.sendDocument(account, customerId, {
          ...document, uploadId: document.upload.id,
        }, new File(document.uri));
        removeFile(document.uri);
        sent++;
      }
      setMessage(sent === 1 ? '1 fil sparades under Underlag i kundportalen.'
        : sent + ' filer sparades under Underlag i kundportalen.');
    } catch (error) {
      const progress = sent ? sent + ' filer sparades. ' : '';
      if (error.status === 401 || ['refresh_token_not_found', 'refresh_token_already_used'].includes(error.portalCode)) {
        await SecureStore.deleteItemAsync(sessionKey).catch(() => {});
        setSession(null);
        setCustomerId(null);
        setMessage(progress + 'Logga in igen för att skicka återstående filer.');
      } else {
        setMessage(progress + 'Återstående filer ligger kvar. Kontrollera anslutningen och försök igen.');
      }
    } finally {
      actionLock.current = false;
      setSending(false);
      setWorking(false);
    }
  }

  if (cameraOpen) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.cameraPanel}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Fotografera underlag</Text>
            <Text style={styles.gold}>{sessionCount} sparade</Text>
          </View>
          <View style={styles.viewfinder}>
            <CameraView
              ref={camera}
              style={StyleSheet.absoluteFill}
              facing="back"
              onCameraReady={() => setCameraReady(true)}
              onMountError={() => {
                setCameraReady(false);
                setMessage('Kameran kunde inte starta. Stäng kameran och försök igen.');
              }}
            />
            {photo && <Image source={{ uri: photo.uri }} resizeMode="contain" style={styles.preview} />}
          </View>
          {!!message && <Text accessibilityLiveRegion="polite" style={styles.status}>{message}</Text>}
          {photo ? (
            <>
              <Button primary title="Spara och ta nästa foto" onPress={acceptPhoto} />
              <Button title="Ta om" onPress={() => { discard(photo.uri); setPhoto(null); }} />
            </>
          ) : (
            <>
              <Button primary title={capturing ? 'Tar foto…' : 'Ta foto'} disabled={!cameraReady || capturing} onPress={capture} />
              <Button title="Klar – stäng kameran" disabled={capturing} onPress={closeCamera} />
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Image source={logo} style={styles.logo} resizeMode="contain" accessible accessibilityLabel="Starenborg Redovisning" />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {restoring ? (
          <Text accessibilityLiveRegion="polite" style={styles.body}>Kontrollerar inloggning…</Text>
        ) : !session ? (
          <View style={styles.account}>
            <Text accessibilityRole="header" style={styles.title}>Logga in</Text>
            <TextInput style={styles.input} accessibilityLabel="E-post" placeholder="E-post"
              placeholderTextColor={muted} value={email} onChangeText={setEmail} editable={!working}
              autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
            <TextInput style={styles.input} accessibilityLabel="Lösenord" placeholder="Lösenord"
              placeholderTextColor={muted} value={password} onChangeText={setPassword} editable={!working}
              secureTextEntry autoComplete="current-password" />
            <View style={styles.sectionHead}>
              <Text style={styles.body}>Håll mig inloggad</Text>
              <Switch accessibilityLabel="Håll mig inloggad" value={remember}
                onValueChange={setRemember} disabled={working} />
            </View>
            <Button title={working ? 'Loggar in…' : 'Logga in'} primary onPress={signIn}
              disabled={working || !email.trim() || !password} />
          </View>
        ) : (
          <>
            <Text accessibilityRole="header" style={styles.title}>Skicka in underlag</Text>
            <Text style={styles.body}>Fotografera kvitton i följd eller bifoga bilder och PDF-filer.</Text>
            <View style={styles.account}>
              <Text style={styles.body}>Inloggad som {session.email}</Text>
              {session.customers.length === 1 && <Text style={styles.gold}>{session.customers[0].name}</Text>}
              {session.customers.length > 1 && (
                <>
                  <Text style={styles.body}>Välj företag för underlagen</Text>
                  {session.customers.map(customer => (
                    <Button key={customer.id} title={customer.name} primary={customerId === customer.id}
                      disabled={working || Boolean(pendingCompany && pendingCompany !== customer.id)} onPress={() => setCustomerId(customer.id)} />
                  ))}
                </>
              )}
              <Button title="Logga ut" disabled={working} onPress={async () => {
                if (actionLock.current) return;
                actionLock.current = true;
                setWorking(true);
                try {
                  await SecureStore.deleteItemAsync(sessionKey);
                } catch {
                  setMessage('Telefonen kunde inte rensa den sparade inloggningen. Försök logga ut igen.');
                  return;
                } finally {
                  actionLock.current = false;
                  setWorking(false);
                }
                files.forEach(file => discard(file.uri));
                setFiles([]);
                setSession(null);
                setCustomerId(null);
                setEmail('');
                setMessage('');
              }} />
            </View>
            <View style={styles.actions}>
              <View style={styles.action}><Button primary title="Ta foto" onPress={openCamera} disabled={working || !session} /></View>
              <View style={styles.action}><Button title="Lägg till filer" onPress={pickFiles} disabled={working || !session} /></View>
            </View>
            {permission && !permission.granted && !permission.canAskAgain && (
              <Button title="Öppna kamerainställningar" onPress={() => Linking.openSettings().catch(() => setMessage('Telefonens inställningar kunde inte öppnas.'))} />
            )}
            <View style={styles.card}>
              <View style={styles.sectionHead}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>Valda underlag</Text>
                <Text style={styles.gold}>{files.length} {files.length === 1 ? 'fil' : 'filer'}</Text>
              </View>
              {!files.length && <Text style={styles.empty}>Inga underlag tillagda ännu.</Text>}
              {files.map(file => (
                <View key={file.uri} style={styles.row}>
                  {file.image
                    ? <Image source={{ uri: file.uri }} style={styles.thumbnail} />
                    : <Text style={styles.pdf}>PDF</Text>}
                  <Text style={styles.filename} numberOfLines={2}>{file.name}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={'Ta bort ' + file.name}
                    disabled={working} onPress={() => removeFile(file.uri)} style={styles.remove}>
                    <Text style={styles.removeText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
            <Button primary title={sending ? 'Skickar…' : 'Skicka in underlag'} onPress={send}
              disabled={working || !customerId || !files.length} />
          </>
        )}
        {!!message && <Text accessibilityLiveRegion="polite" style={styles.status}>{message}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <ReceiptScreen />
    </SafeAreaProvider>
  );
}

const navy = '#0b1c2c';
const gold = '#d8bd89';
const muted = '#b6c2cf';
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: navy },
  header: { alignItems: 'center', borderBottomWidth: 1, borderColor: '#314457', paddingVertical: 12 },
  logo: { width: 155, height: 76 },
  content: { width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 24, paddingBottom: 30 },
  title: { color: '#fff', fontSize: 27, fontWeight: '700' },
  body: { color: muted, fontSize: 16, lineHeight: 24, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 12, marginVertical: 22 },
  action: { flex: 1 },
  button: { minHeight: 52, padding: 13, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1b344b', borderColor: '#506176', borderWidth: 1 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  primary: { backgroundColor: gold, borderColor: gold },
  primaryText: { color: navy },
  disabled: { opacity: 0.48 },
  card: { backgroundColor: '#142b40', borderWidth: 1, borderColor: '#344c60', borderRadius: 19, padding: 16, marginBottom: 18 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '700', flexShrink: 1 },
  gold: { color: gold, fontSize: 15, fontWeight: '700' },
  empty: { color: muted, textAlign: 'center', paddingVertical: 26 },
  row: { minHeight: 64, alignItems: 'center', flexDirection: 'row', gap: 12, borderTopWidth: 1, borderColor: '#344c60', marginTop: 12, paddingTop: 8 },
  thumbnail: { width: 46, height: 54, borderRadius: 6, backgroundColor: navy },
  pdf: { color: gold, width: 46, textAlign: 'center', fontWeight: '700' },
  filename: { flex: 1, color: '#fff', fontSize: 14 },
  remove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: '#fff', fontSize: 26 },
  account: { gap: 10, marginTop: 18 },
  input: { minHeight: 50, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1,
    borderColor: '#506176', color: '#fff', backgroundColor: '#142b40', fontSize: 16 },
  status: { color: gold, backgroundColor: '#243e53', padding: 12, marginBottom: 10, borderRadius: 10 },
  cameraPanel: { flex: 1, gap: 10, padding: 12 },
  viewfinder: { flex: 1, backgroundColor: '#000', overflow: 'hidden', borderRadius: 14 },
  preview: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%', backgroundColor: '#000' },
});
