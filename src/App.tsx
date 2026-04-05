/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Upload, FileImage, Loader2, AlertCircle, X, Database, CheckCircle2, Camera, ImagePlus, Download } from 'lucide-react';

const SYSTEM_PROMPT = `You are an Aadhaar card data extraction assistant.

The user will send you an image of an Aadhaar card (front, back, or both sides).

Your job is to extract ALL visible information from the card and return it as a single valid JSON object with no markdown, no explanation, no preamble — only the raw JSON.

Extract these fields (use null if not visible or not present):
{
  "name": "",
  "name_regional": "",
  "dob": "",
  "year_of_birth": "",
  "gender": "",
  "aadhaar_number": "",
  "vid": "",
  "mobile_last4": "",
  "address": {
    "care_of": "",
    "house": "",
    "street": "",
    "locality": "",
    "village_town": "",
    "post_office": "",
    "district": "",
    "sub_district": "",
    "state": "",
    "pincode": "",
    "country": ""
  },
  "issue_date": "",
  "download_date": "",
  "is_masked": false,
  "card_type": ""
}

Rules:
- aadhaar_number: extract exactly as printed, with or without spaces (e.g. "1234 5678 9012"). If masked, return as "XXXX XXXX 9012".
- dob: return in DD/MM/YYYY format if visible, else return year only in year_of_birth.
- gender: return "Male", "Female", or "Transgender".
- card_type: "e-Aadhaar", "Aadhaar Letter", "PVC Card", or "Aadhaar Card" based on visual clues.
- is_masked: true if the first 8 digits are hidden/masked.
- name_regional: the name printed in regional language (Hindi/Odia/etc.) if visible.
- If both sides are shown, merge all fields into one object.
- Return ONLY the JSON. No backticks, no markdown, no extra text.`;

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Camera State
  const [isCameraMode, setIsCameraMode] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Google Sheets Integration State
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // PWA Install State
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstallable(false);
    }
    setDeferredPrompt(null);
  };

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Attach stream to video element when it becomes available
  useEffect(() => {
    if (isCameraMode && videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [isCameraMode, stream]);

  const startCamera = async () => {
    try {
      // Set camera mode true first so the video element renders
      setIsCameraMode(true);
      clearFile();
      
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      setStream(mediaStream);
    } catch (err) {
      console.error("Error accessing camera:", err);
      setError("Camera access denied or not available. Please check permissions.");
      setIsCameraMode(false);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setIsCameraMode(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) {
            const capturedFile = new File([blob], "captured_aadhaar.jpg", { type: "image/jpeg" });
            setFile(capturedFile);
            setPreviewUrl(URL.createObjectURL(capturedFile));
            stopCamera();
          }
        }, 'image/jpeg', 0.9);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setPreviewUrl(URL.createObjectURL(selectedFile));
      setResult(null);
      setError(null);
      setSaveSuccess(false);
      setSaveError(null);
      stopCamera();
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const selectedFile = e.dataTransfer.files[0];
      if (selectedFile.type.startsWith('image/')) {
        setFile(selectedFile);
        setPreviewUrl(URL.createObjectURL(selectedFile));
        setResult(null);
        setError(null);
        setSaveSuccess(false);
        setSaveError(null);
        stopCamera();
      }
    }
  };

  const clearFile = () => {
    setFile(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    setSaveSuccess(false);
    setSaveError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result.split(',')[1]);
        } else {
          reject(new Error('Failed to convert file to base64'));
        }
      };
      reader.onerror = error => reject(error);
    });
  };

  const handleExtract = async () => {
    if (!file) return;
    
    setLoading(true);
    setError(null);
    setResult(null);
    setSaveSuccess(false);
    setSaveError(null);
    
    try {
      const base64Data = await fileToBase64(file);
      const mimeType = file.type;
      
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: {
          parts: [
            { text: SYSTEM_PROMPT },
            { inlineData: { data: base64Data, mimeType } }
          ]
        },
        config: {
          responseMimeType: "application/json",
        }
      });
      
      const text = response.text;
      if (text) {
        try {
          setResult(JSON.parse(text));
        } catch (e) {
          const cleaned = text.replace(/```json\n|```\n|```/g, '').trim();
          setResult(JSON.parse(cleaned));
        }
      } else {
        setError("No text returned from model.");
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred during extraction.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToSheets = async () => {
    const scriptUrl = process.env.Google_Sheet;
    if (!result) return;
    if (!scriptUrl) {
      setSaveError("Google_Sheet secret is not configured in AI Studio.");
      return;
    }
    
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    
    try {
      const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(result)
      });
      
      const data = await response.json();
      
      if (data.status === 'success') {
        setSaveSuccess(true);
      } else {
        throw new Error(data.message || 'Failed to save to Google Sheets');
      }
    } catch (err: any) {
      console.error(err);
      setSaveError(err.message || "Failed to connect to Google Apps Script. Check the URL and CORS settings.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8 font-sans text-gray-900 relative">
      {isInstallable && (
        <button
          onClick={handleInstallClick}
          className="absolute top-4 right-4 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-full text-sm font-medium shadow-md transition-all z-50"
        >
          <Download className="w-4 h-4" />
          Install App
        </button>
      )}
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Aadhaar Data Extractor</h1>
          <p className="text-gray-500">Extract details from Aadhaar cards and sync directly to Google Sheets.</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column: Upload & Config */}
          <div className="space-y-6">
            {/* Input Section */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium">1. Provide Image</h2>
                <div className="flex bg-gray-100 p-1 rounded-lg">
                  <button
                    onClick={() => {
                      stopCamera();
                      clearFile();
                    }}
                    className={!isCameraMode && !file ? "px-3 py-1.5 text-sm font-medium rounded-md transition-colors bg-white shadow-sm text-blue-600" : "px-3 py-1.5 text-sm font-medium rounded-md transition-colors text-gray-600 hover:text-gray-900"}
                  >
                    <ImagePlus className="w-4 h-4 inline-block mr-1.5" />
                    Upload
                  </button>
                  <button
                    onClick={startCamera}
                    className={isCameraMode ? "px-3 py-1.5 text-sm font-medium rounded-md transition-colors bg-white shadow-sm text-blue-600" : "px-3 py-1.5 text-sm font-medium rounded-md transition-colors text-gray-600 hover:text-gray-900"}
                  >
                    <Camera className="w-4 h-4 inline-block mr-1.5" />
                    Camera
                  </button>
                </div>
              </div>
              
              {isCameraMode ? (
                <div className="space-y-4">
                  <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-black aspect-video flex items-center justify-center">
                    <video 
                      ref={videoRef} 
                      autoPlay 
                      playsInline 
                      className="w-full h-full object-cover"
                    />
                    <canvas ref={canvasRef} className="hidden" />
                  </div>
                  <button
                    onClick={capturePhoto}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center"
                  >
                    <Camera className="w-5 h-5 mr-2" />
                    Capture Photo
                  </button>
                </div>
              ) : !file ? (
                <div 
                  className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-gray-50 transition-colors cursor-pointer"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mx-auto h-10 w-10 text-gray-400 mb-4" />
                  <p className="text-sm font-medium text-gray-700">Click to upload or drag and drop</p>
                  <p className="text-xs text-gray-500 mt-1">PNG, JPG, JPEG up to 10MB</p>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange} 
                    accept="image/*" 
                    className="hidden" 
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-100 aspect-video flex items-center justify-center">
                    <img src={previewUrl!} alt="Preview" className="max-h-full object-contain" />
                    <button 
                      onClick={clearFile}
                      className="absolute top-2 right-2 p-1.5 bg-white/80 hover:bg-white text-gray-700 rounded-full shadow-sm backdrop-blur-sm transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between bg-gray-50 p-3 rounded-lg border border-gray-100">
                    <div className="flex items-center space-x-3 overflow-hidden">
                      <FileImage className="w-5 h-5 text-blue-500 flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{file.name}</span>
                    </div>
                    <span className="text-xs text-gray-500 flex-shrink-0">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </div>

                  <button
                    onClick={handleExtract}
                    disabled={loading}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        Extracting Data...
                      </>
                    ) : (
                      'Extract Information'
                    )}
                  </button>
                </div>
              )}

              {error && (
                <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg flex items-start space-x-3 border border-red-100">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <p className="text-sm">{error}</p>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Results */}
          <div className="space-y-4">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 h-full flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium">Extracted Data</h2>
                {result && (
                  <button
                    onClick={handleSaveToSheets}
                    disabled={isSaving || saveSuccess}
                    className="py-1.5 px-4 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg font-medium transition-colors flex items-center disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {isSaving ? (
                      <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving...</>
                    ) : saveSuccess ? (
                      <><CheckCircle2 className="w-4 h-4 mr-2" /> Saved</>
                    ) : (
                      'Save to Sheets'
                    )}
                  </button>
                )}
              </div>
              
              {saveError && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg flex items-start space-x-2 border border-red-100 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>{saveError}</p>
                </div>
              )}

              {result ? (
                <div className="flex-1 bg-gray-900 rounded-xl p-4 overflow-auto">
                  <pre className="text-sm font-mono text-green-400 whitespace-pre-wrap">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-100 rounded-xl p-8">
                  <FileImage className="w-12 h-12 mb-3 opacity-20" />
                  <p className="text-sm text-center">Provide an image and click extract to see the results here.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
