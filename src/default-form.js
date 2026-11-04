/* ===== שאלון התחלתי =====
   נטען רק בהפעלה הראשונה, כנקודת פתיחה לעריכה בבונה השאלונים.
   מזהי השאלות והאפשרויות קבועים — התשובות נשמרות לפיהם, כך ששינוי ניסוח
   לא מנתק תשובות קיימות. */

export const DEFAULT_FORM = {
  "title": "שאלון לאיש האית״ן",
  "intro": "שלום לכולם\nכחלק מתהליך הקמת היחידה הפיקודית החדשה והקמת הפלגה שלנו אנחנו מבקשים מכל אחד מכל למלא את השאלון הבא על מנת שנוכל לבנות את תמונת כוח האדם שלנו בצורה אידיאלית.",
  "sections": [
    {
      "id": "personal",
      "title": "פרטים אישיים",
      "description": "",
      "questions": [
        {
          "id": "full_name",
          "type": "short",
          "label": "שם מלא",
          "required": true
        },
        {
          "id": "birthdate",
          "type": "date",
          "label": "תאריך לידה",
          "required": true,
          "isBirthdate": true
        },
        {
          "id": "city",
          "type": "short",
          "label": "מקום מגורים (יישוב)",
          "required": true,
          "groupInDashboard": true
        },
        {
          "id": "phone",
          "type": "phone",
          "label": "טלפון נייד",
          "required": true
        },
        {
          "id": "email",
          "type": "email",
          "label": "דואר אלקטרוני",
          "required": false
        },
        {
          "id": "license",
          "type": "multi",
          "label": "רישיונות נהיגה- אזרחי",
          "required": false,
          "options": [
            {
              "id": "lic1",
              "label": "אין רישיון"
            },
            {
              "id": "lic2",
              "label": "B — רכב פרטי"
            },
            {
              "id": "lic3",
              "label": "C1 — משאית קלה"
            },
            {
              "id": "lic4",
              "label": "C — משאית"
            },
            {
              "id": "lic5",
              "label": "טרקטור"
            },
            {
              "id": "lic6",
              "label": "מלגזה"
            }
          ]
        },
        {
          "id": "q_h3jsnu",
          "type": "multi",
          "label": "רישיונות נהיגה- צבאי ",
          "required": true,
          "options": [
            {
              "id": "o_230cdn",
              "label": "אין רישיון"
            },
            {
              "id": "o_zy82vy",
              "label": "B — רכב פרטי"
            },
            {
              "id": "o_a07n2c",
              "label": "C1 — משאית קלה"
            },
            {
              "id": "o_3r58h9",
              "label": "C — משאית"
            }
          ]
        }
      ]
    },
    {
      "id": "background",
      "title": "עיסוק אזרחי",
      "description": "",
      "questions": [
        {
          "id": "education",
          "type": "long",
          "label": "מקצוע",
          "required": true
        },
        {
          "id": "years_exp",
          "type": "long",
          "label": "הכשרה",
          "required": true,
          "help": "לימודים באוניברסיטה, הכשרות מקצועיות, לימודי תעודה וכן הלאה...."
        }
      ]
    },
    {
      "id": "skills",
      "title": "כישורים",
      "description": "דרג/י את רמת השליטה שלך, מ-1 (אין שליטה) עד 5 (מומחה/ית)",
      "questions": [
        {
          "id": "sk_office",
          "type": "scale",
          "label": "תוכנות אופיס (Word, Excel)",
          "required": true,
          "scale": {
            "min": 1,
            "max": 5,
            "labels": [
              "אין שליטה",
              "בסיסית",
              "בינונית",
              "טובה",
              "מומחה/ית"
            ]
          }
        },
        {
          "id": "sk_digital",
          "type": "scale",
          "label": "עבודה עם אפליקציות ומערכות דיגיטליות",
          "required": true,
          "scale": {
            "min": 1,
            "max": 5,
            "labels": [
              "אין שליטה",
              "בסיסית",
              "בינונית",
              "טובה",
              "מומחה/ית"
            ]
          }
        },
        {
          "id": "sk_team",
          "type": "scale",
          "label": "עבודת צוות",
          "required": true,
          "scale": {
            "min": 1,
            "max": 5,
            "labels": [
              "אין שליטה",
              "בסיסית",
              "בינונית",
              "טובה",
              "מומחה/ית"
            ]
          }
        },
        {
          "id": "sk_time",
          "type": "scale",
          "label": "ניהול זמן ועמידה במשימות",
          "required": true,
          "scale": {
            "min": 1,
            "max": 5,
            "labels": [
              "אין שליטה",
              "בסיסית",
              "בינונית",
              "טובה",
              "מומחה/ית"
            ]
          }
        },
        {
          "id": "languages",
          "type": "multi",
          "label": "שפות שאני דובר/ת",
          "required": false,
          "options": [
            {
              "id": "lang1",
              "label": "עברית"
            },
            {
              "id": "lang2",
              "label": "אנגלית"
            },
            {
              "id": "lang3",
              "label": "ערבית"
            },
            {
              "id": "lang4",
              "label": "רוסית"
            },
            {
              "id": "lang5",
              "label": "אמהרית"
            },
            {
              "id": "lang6",
              "label": "צרפתית"
            },
            {
              "id": "lang7",
              "label": "ספרדית"
            }
          ],
          "allowOther": true
        },
        {
          "id": "q_ijzf65",
          "type": "long",
          "label": "כישורים ייחודיים",
          "required": false,
          "help": "האם יש לכם כישורים ייחודיים שאתם חושבים שיכולים להיות רלוונטיים ליחידה? גם תחביבים או עיסוק צדדי יכולים להיות רלוונטיים"
        }
      ]
    },
    {
      "id": "s_vrrmd8",
      "title": "שירות צבאי",
      "description": "",
      "questions": [
        {
          "id": "q_zy34oa",
          "type": "short",
          "label": "סדיר- באיזו יחידה שירתת?",
          "required": true
        },
        {
          "id": "q_t06skz",
          "type": "long",
          "label": "שירות סדיר- פירוט תפקידים",
          "required": true
        },
        {
          "id": "q_qrpgny",
          "type": "short",
          "label": "שירות סדיר- קורסים והכשרות",
          "required": true,
          "help": "אנא רשמו קורסי פיקוד, קורסים מקצועיים, הכשרות (נשקים, נהיגה, חובשים וכיוב)"
        },
        {
          "id": "q_iwe288",
          "type": "long",
          "label": "שירות מילואים- לפני האית״ן",
          "required": false,
          "help": "היכן שירתתם ובאיזה תפקידים לפני הגעתכם ליחידה? "
        },
        {
          "id": "q_1xi6r6",
          "type": "single",
          "label": "ותק ביחידה",
          "required": false,
          "options": [
            {
              "id": "o_f4d1pa",
              "label": "שנה"
            },
            {
              "id": "o_aoiy20",
              "label": "2"
            },
            {
              "id": "o_l555m0",
              "label": "3"
            },
            {
              "id": "o_yvrwjd",
              "label": "4"
            },
            {
              "id": "o_ehc49e",
              "label": "5"
            },
            {
              "id": "o_7u3zxd",
              "label": "6"
            },
            {
              "id": "o_46xxl8",
              "label": "7"
            },
            {
              "id": "o_hmxy13",
              "label": "8"
            },
            {
              "id": "o_gv7y7h",
              "label": "9"
            },
            {
              "id": "o_pw1sfy",
              "label": "10 ומעלה"
            }
          ],
          "help": "כמה זמן אתם משרתים באית״ן? "
        },
        {
          "id": "q_1jdkwc",
          "type": "single",
          "label": "קורס הכשרת יסוד (״קק״צ אית״ן)- האם עברתם? ",
          "required": false,
          "options": [
            {
              "id": "o_m1kbvb",
              "label": "כן"
            },
            {
              "id": "o_aijq83",
              "label": "לא"
            },
            {
              "id": "o_i9ndhf",
              "label": "לא- משובץ לקורס הקרוב"
            }
          ]
        }
      ]
    },
    {
      "id": "s_ryinfc",
      "title": "ציוד אישי",
      "description": "אנא מלאו קיום/חוסר של ציוד אישי ",
      "questions": [
        {
          "id": "q_d6tbv0",
          "type": "yesno",
          "label": "מדים",
          "required": true,
          "items": [
            {
              "id": "o_me51cq",
              "label": "מכנס"
            },
            {
              "id": "o_hu4auu",
              "label": "חולצה"
            },
            {
              "id": "o_5qoogk",
              "label": "דיסקית צוואר"
            },
            {
              "id": "o_9f3bkw",
              "label": "דיסקית נעליים"
            }
          ]
        },
        {
          "id": "q_v2rka8",
          "type": "yesno",
          "label": "ציוד לחימה אישי ",
          "required": true,
          "items": [
            {
              "id": "o_bof2vs",
              "label": "קסדה צבאית תקנית"
            },
            {
              "id": "o_jiyq5p",
              "label": "ווסט קרמי צבאי תקני"
            },
            {
              "id": "o_l71sap",
              "label": "ברכיות "
            }
          ]
        },
        {
          "id": "q_gsz65z",
          "type": "long",
          "label": "ציוד אית״ן",
          "required": true,
          "help": "אם ברשתוכם ציוד אית״ן אנא פרטו. "
        },
        {
          "id": "q_pt99wc",
          "type": "long",
          "label": "חוסרים- כללי",
          "required": false,
          "help": "במידה ויש לכם חוסרים שלא מופיעים ברשימה זו, או משהו שתרצו לציין באופן ספציפי- זה המקום!"
        }
      ]
    },
    {
      "id": "s_hnyxtj",
      "title": "מטווחים ב-3 השנים האחרונות",
      "description": "",
      "questions": [
        {
          "id": "q_0xzgyl",
          "type": "single",
          "label": "האם ביצעת מטווח ב-3 השנים האחרונות? ",
          "required": true,
          "options": [
            {
              "id": "o_7zi0c7",
              "label": "כן"
            },
            {
              "id": "o_0v9g8k",
              "label": "לא"
            }
          ]
        }
      ]
    },
    {
      "id": "s_52rj3n",
      "title": "כללי והערות אישיות ",
      "description": "זה המקום לכתוב לנו בקשות מיוחדות, עדכונים, הערות- כל דבר שתרצו ולא מופיע בשאלות. ",
      "questions": [
        {
          "id": "q_n6fxm8",
          "type": "long",
          "label": "כללי",
          "required": false
        }
      ]
    }
  ]
};
